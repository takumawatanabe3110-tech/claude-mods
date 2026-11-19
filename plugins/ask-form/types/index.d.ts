export type FieldType = 'text' | 'textarea' | 'number' | 'radio' | 'checkbox' | 'select'

export type Field = {
  id: string
  label: string
  type: FieldType
  options?: string[]
  placeholder?: string
  required?: boolean
  default?: string | string[]
}

export type Form = {
  id: string
  title: string
  description?: string
  fields: Field[]
  values: Record<string, string | string[]>
  status: 'open' | 'done'
}

declare module 'claude-code' {
  interface PluginState {
    'ask-form': { forms: Shaped<Form[]> }
  }
}
