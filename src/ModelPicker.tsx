import { Icon } from './Icon'
import { CLAUDE_MODELS } from './claude-chat'

export default function ModelPicker({ model, disabled, onChange }: {
  model: string; disabled: boolean
  onChange: (model: string) => void
}) {
  return <label className="model-picker" title="Choose a Claude model">
    <select aria-label="Claude model" value={model} disabled={disabled} onChange={event => onChange(event.target.value)}>
      {CLAUDE_MODELS.map(name => <option key={name} value={name}>Claude {name[0].toUpperCase()}{name.slice(1)}</option>)}
    </select><Icon name="chevron" size={12} className="turn-down" />
  </label>
}
