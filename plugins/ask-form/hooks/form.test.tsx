import { expect, test } from 'claude-code/testing'

test('form renders, takes answers and submits them', async ($, on) => {
  let paneId = ''
  let submitted = ''
  on('tool.register', () => ({ value: { tool: 'mcp__ask-form__ask' } }))
  on('ui.open', (_, e) => {
    paneId = (e as { id: string }).id
    return { value: { isPlaced: true } }
  })
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.close', () => ({ value: undefined }))
  on('prompt.submit', (_, e) => {
    submitted = (e as { text: string }).text
    return { text: (e as { text: string }).text } as never
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const r = await $.tool.call({
    tool: 'mcp__ask-form__ask',
    title: 'BGM設定',
    fields: [
      { id: 'name', label: '番組名', type: 'text', required: true },
      { id: 'mode', label: 'モード', type: 'radio', options: ['自動', '手動'] },
      { id: 'fx', label: '処理', type: 'checkbox', options: ['EQ', 'コンプ'] },
      { id: 'sr', label: 'SR', type: 'select', options: ['44100', '48000'] },
    ],
  } as never)
  expect(JSON.stringify(r)).toContain('form_id')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'ask-form', surface, component: 'Pane', requestId: paneId,
      props: { title: 'BGM設定', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
    } as never)
    expect((await ui.find({ type: 'Text', text: /BGM設定/ }))?.text).toBe('BGM設定')
    await ui.unmount()
  }

  const ui = await $.ui.mount({
    plugin: 'ask-form', surface: 'desktop', component: 'Pane', requestId: paneId,
    props: { title: 'BGM設定', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  } as never)
  await ui.press({ key: 'submit' } as never)
  expect(submitted).toBe('') // required field empty -> not submitted
  await ui.input({ key: 'in:name', text: 'テスト回', kind: 'change' } as never)
  await ui.press({ key: 'rad:mode:1' } as never)
  await ui.press({ key: 'chk:fx:0' } as never)
  await ui.select({ key: 'sel:sr', value: '48000' } as never)
  await ui.press({ key: 'submit' } as never)
  expect(submitted).toContain('"name": "テスト回"')
  expect(submitted).toContain('"mode": "手動"')
  expect(submitted).toContain('"EQ"')
  expect(submitted).toContain('"sr": "48000"')
  await ui.unmount()
})
