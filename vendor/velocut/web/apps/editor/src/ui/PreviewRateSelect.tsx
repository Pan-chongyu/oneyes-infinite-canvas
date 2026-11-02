import { PREVIEW_RATES } from '@velocut/render-sdk';
import { Icon } from './primitives/Icon';

export function PreviewRateSelect({ rate, onChange, label }: {
  rate: number;
  onChange: (rate: number) => void;
  label: string;
}) {
  return (
    <label className="preview-rate" title="仅调整预览速度，成片不变；预览音调随速度变化。">
      <Icon name="video" size={13} />
      <span>预览</span>
      <select aria-label={label} value={String(rate)} onChange={e => onChange(Number(e.target.value))}>
        {PREVIEW_RATES.map(value => <option key={value} value={value}>{value}×</option>)}
      </select>
    </label>
  );
}
