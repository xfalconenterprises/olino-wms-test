import { Fragment, type CSSProperties, type ReactNode } from 'react';

// "Label: value • Label: value" item details. A detail that was not entered is not shown,
// so there are no "—" placeholders or stray separators.

export type Spec = [label: string, value: ReactNode, valueStyle?: CSSProperties];

const filled = (value: ReactNode) => value !== null && value !== undefined && value !== false && String(value).trim() !== '';

export default function SpecLine({ specs, separator = '•', separatorStyle = { margin: '0 8px', color: '#cbd5e1' } }: {
  specs: Spec[];
  separator?: string;
  separatorStyle?: CSSProperties;
}) {
  return (
    <>
      {specs.filter(([, value]) => filled(value)).map(([label, value, style], i) => (
        <Fragment key={label}>
          {i > 0 && <span style={separatorStyle}>{separator}</span>}
          {label}: <strong style={style}>{value}</strong>
        </Fragment>
      ))}
    </>
  );
}
