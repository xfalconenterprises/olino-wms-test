// A row of large buttons for choosing one option, easier on a touch screen than a dropdown.
export default function TouchChoice<T extends string>({ options, value, onChange, label }: {
  options: readonly (readonly [T, string])[];
  value: T | '';
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {options.map(([key, text]) => (
        <button key={key} type="button" aria-pressed={value === key} onClick={() => onChange(key)}
          className={`btn ${value === key ? 'btn-primary' : 'btn-secondary'}`}
          style={{ minHeight: 48, flex: '1 1 auto', justifyContent: 'center', touchAction: 'manipulation' }}>
          {text}
        </button>
      ))}
    </div>
  );
}
