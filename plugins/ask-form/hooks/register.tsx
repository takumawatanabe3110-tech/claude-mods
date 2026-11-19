import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Field, Form } from '../types'

// Change the tag when Form's fields change: it declines what an earlier version stored.
const forms = atom({ plugin: 'ask-form', key: 'forms' } as const, [] as Form[], {
  shape: 'forms-1',
})

const PANE_PREFIX = 'ask-'
const TOOL = 'mcp__ask-form__ask'

const DESCRIPTION = `ユーザーに入力・選択を求めるフォームを、画面右側の新しいタブに表示します。
ユーザーへの質問・確認・選択肢の提示が必要なときは、チャット本文で質問する代わりにこのツールを使ってください。
質問の性質に合わせてフィールドの type を選びます:
- text: 短い自由記述 / textarea: 長い自由記述 / number: 数値
- radio: 少数（2〜6個）の選択肢から1つ / select: 多数の選択肢から1つ（プルダウン）
- checkbox: 複数選択可（options を指定。options なしなら単独の「はい/いいえ」チェック）
radio/select/checkbox には options が必要です。default で初期値を指定できます。
このツールはフォームを表示するだけで、すぐに戻ります。呼んだ後はユーザーの回答を待つため、それ以上作業せずターンを終えてください。
回答は「[ask-form回答] <form_id>」で始まるメッセージとして JSON で届きます。`

const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'タブに表示する短い題名' },
    description: { type: 'string', description: 'フォーム上部の説明（任意）' },
    fields: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '回答JSONのキー' },
          label: { type: 'string' },
          type: {
            type: 'string',
            enum: ['text', 'textarea', 'number', 'radio', 'checkbox', 'select'],
          },
          options: { type: 'array', items: { type: 'string' } },
          placeholder: { type: 'string' },
          required: { type: 'boolean' },
          default: {
            anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
          },
        },
        required: ['id', 'label', 'type'],
      },
    },
  },
  required: ['title', 'fields'],
}

function initialValue(f: Field): string | string[] {
  if (f.type === 'checkbox') {
    if (Array.isArray(f.default)) return f.default
    return typeof f.default === 'string' && f.default !== '' ? [f.default] : []
  }
  if (typeof f.default === 'string') return f.default
  if ((f.type === 'select' || f.type === 'radio') && f.options?.length) {
    return f.type === 'select' ? (f.options[0] ?? '') : ''
  }
  return ''
}

function isEmpty(v: string | string[] | undefined): boolean {
  return v === undefined || (Array.isArray(v) ? v.length === 0 : v.trim() === '')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'ask',
      description: DESCRIPTION,
      inputSchema: SCHEMA,
      isDeferred: false,
    })
    // Reopen the tabs of forms still waiting for an answer (after a reload or resume).
    for (const f of await read($, forms)) {
      if (f.status === 'open') void $.ui.open({ id: PANE_PREFIX + f.id, title: f.title })
    }
    return next(e)
  })

  on('tool.run', { tool: TOOL }, async ($, e) => {
    const input = e as unknown as { title?: string; description?: string; fields?: Field[] }
    const fields = (input.fields ?? []).filter(f => f && f.id && f.label && f.type)
    if (fields.length === 0) return { deny: 'fields が空です。' }
    for (const f of fields) {
      if (['radio', 'select'].includes(f.type) && !f.options?.length) {
        return { deny: `フィールド ${f.id} (${f.type}) には options が必要です。` }
      }
    }
    const id = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`
    const title = (input.title || '質問').slice(0, 40)
    const form: Form = {
      id,
      title,
      description: input.description,
      fields,
      values: Object.fromEntries(fields.map(f => [f.id, initialValue(f)])),
      status: 'open',
    }
    await update($, forms, list => [...list.filter(f => f.status === 'open'), form].slice(-20))
    const opened = await $.ui.open({ id: PANE_PREFIX + id, title, focus: true })
    if (!opened.isPlaced) {
      return {
        result: `フォーム「${title}」(form_id: ${id}) を開きましたが、いまの画面ではタブが表示されていません（この画面はModのパネル表示に対応していない可能性があります）。表示できる画面で開くと現れます。ユーザーには、使っているアプリと、右側のパネルが見えているかを確認してください。`,
      }
    }
    return {
      result: `フォーム「${title}」(form_id: ${id}) を右側のタブに表示しました。ユーザーの回答を待つため、ここでターンを終えてください。`,
    }
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    const paneId = (e as { requestId?: string }).requestId ?? ''
    if (!paneId.startsWith(PANE_PREFIX)) return next(e)
    const formId = paneId.slice(PANE_PREFIX.length)
    const form = (await read($, forms)).find(f => f.id === formId)
    const { Box, Text, Button, Input, Select } = $.ui.resolve(e)

    if (!form) {
      return (
        <Box>
          <Text dimColor>このフォームは終了しました。</Text>
        </Box>
      )
    }

    const setValue = (fieldId: string, fn: (v: string | string[]) => string | string[]) =>
      update($, forms, list =>
        list.map(f =>
          f.id === formId ? { ...f, values: { ...f.values, [fieldId]: fn(f.values[fieldId] ?? '') } } : f,
        ),
      )

    const finish = async (cancelled: boolean) => {
      const now = (await read($, forms)).find(f => f.id === formId)
      if (!now || now.status !== 'open') return
      if (!cancelled) {
        const missing = now.fields.filter(f => f.required && isEmpty(now.values[f.id]))
        if (missing.length) {
          $.ui.toast(`未入力の必須項目: ${missing.map(f => f.label).join('、')}`)
          return
        }
      }
      const answers: Record<string, unknown> = {}
      for (const f of now.fields) {
        const v = now.values[f.id]
        if (f.type === 'number' && typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) {
          answers[f.id] = Number(v)
        } else if (f.type === 'checkbox' && !f.options?.length) {
          answers[f.id] = Array.isArray(v) && v.length > 0
        } else {
          answers[f.id] = v
        }
      }
      await update($, forms, list => list.filter(f => f.id !== formId))
      await $.ui.close({ id: paneId })
      const body = cancelled
        ? 'ユーザーはこのフォームへの回答をキャンセルしました。'
        : '```json\n' + JSON.stringify(answers, null, 2) + '\n```'
      await $.prompt.submit({ text: `[ask-form回答] ${formId}「${now.title}」\n${body}` })
    }

    const renderField = (f: Field, index: number) => {
      const v = form.values[f.id]
      const label = `${f.label}${f.required ? ' *' : ''}`
      if (f.type === 'text' || f.type === 'number' || f.type === 'textarea') {
        return (
          <Box flexDirection="column">
            <Text bold>{label}</Text>
            <Input
              key={`in:${f.id}`}
              value={typeof v === 'string' ? v : ''}
              placeholder={f.placeholder ?? (f.type === 'number' ? '数値' : '')}
              rows={f.type === 'textarea' ? 4 : undefined}
              submitLabel="確定"
              autoFocus={index === 0 ? true : undefined}
              onInput={value => void setValue(f.id, () => value)}
              onSubmit={value => void setValue(f.id, () => value)}
            />
          </Box>
        )
      }
      if (f.type === 'select') {
        return (
          <Box flexDirection="column">
            <Text bold>{label}</Text>
            <Select
              key={`sel:${f.id}`}
              options={(f.options ?? []).map(o => ({ value: o }))}
              value={typeof v === 'string' ? v : undefined}
              onSelect={value => void setValue(f.id, () => value)}
            />
          </Box>
        )
      }
      if (f.type === 'radio') {
        return (
          <Box flexDirection="column">
            <Text bold>{label}</Text>
            {(f.options ?? []).map((o, i) => (
              <Button
                key={`rad:${f.id}:${i}`}
                label={`${v === o ? '◉' : '○'} ${o}`}
                onPress={() => void setValue(f.id, () => o)}
              />
            ))}
          </Box>
        )
      }
      // checkbox
      const checked = Array.isArray(v) ? v : []
      const opts = f.options?.length ? f.options : ['はい']
      return (
        <Box flexDirection="column">
          <Text bold>{label}</Text>
          {opts.map((o, i) => (
            <Button
              key={`chk:${f.id}:${i}`}
              label={`${checked.includes(o) ? '☑' : '☐'} ${o}`}
              onPress={() =>
                void setValue(f.id, cur => {
                  const arr = Array.isArray(cur) ? cur : []
                  return arr.includes(o) ? arr.filter(x => x !== o) : [...arr, o]
                })
              }
            />
          ))}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>{form.title}</Text>
        {form.description ? <Text>{form.description}</Text> : null}
        {form.fields.map((f, i) => renderField(f, i))}
        <Box gap={1}>
          <Button key="submit" label="送信" onPress={() => void finish(false)} />
          <Button key="cancel" label="キャンセル" onPress={() => void finish(true)} />
        </Box>
        <Text dimColor>* は必須項目</Text>
      </Box>
    )
  })
}
