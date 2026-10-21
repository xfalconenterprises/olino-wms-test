// Code 128B Lightweight Native SVG Barcode Generator
// Generates standard industrial Code 128 Type B barcodes without external dependencies

const CODE128_PATTERNS: string[] = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213", // 0-9
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132", // 10-19
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211", // 20-29
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313", // 30-39
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331", // 40-49
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111", // 50-59
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214", // 60-69
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111", // 70-79
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141", // 80-89
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141", // 90-99
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112"                                 // 100-106
];

function encodeCode128B(text: string): string {
  // Start Code B is index 104
  let checksum = 104;
  const patternList: string[] = [CODE128_PATTERNS[104]];

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i) - 32;
    if (code >= 0 && code <= 95) {
      checksum += code * (i + 1);
      patternList.push(CODE128_PATTERNS[code]);
    }
  }

  // Checksum modulo 103
  const checkDigit = checksum % 103;
  patternList.push(CODE128_PATTERNS[checkDigit]);

  // Stop character is index 106
  patternList.push(CODE128_PATTERNS[106]);

  return patternList.join('');
}

interface BadgeBarcodeProps {
  value: string;
  width?: number;
  height?: number;
  showText?: boolean;
}

export default function BadgeBarcode({
  value,
  width = 240,
  height = 54,
  showText = true,
}: BadgeBarcodeProps) {
  if (!value) return null;

  const pattern = encodeCode128B(value);
  // Calculate total modules: each digit in pattern is module width
  let totalModules = 0;
  for (let i = 0; i < pattern.length; i++) {
    totalModules += parseInt(pattern[i], 10);
  }

  // Module width in svg viewBox units
  const moduleWidth = width / totalModules;
  let currentX = 0;
  const bars: { x: number; w: number }[] = [];

  for (let i = 0; i < pattern.length; i++) {
    const modCount = parseInt(pattern[i], 10);
    const barW = modCount * moduleWidth;
    // Even indices are bars (black), odd are spaces (white)
    if (i % 2 === 0) {
      bars.push({ x: currentX, w: barW });
    }
    currentX += barW;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ display: 'block', maxWidth: '100%' }}
      >
        <rect width={width} height={height} fill="#ffffff" />
        {bars.map((bar, idx) => (
          <rect
            key={idx}
            x={bar.x}
            y={0}
            width={bar.w}
            height={height}
            fill="#000000"
          />
        ))}
      </svg>
      {showText && (
        <span
          style={{
            fontFamily: 'monospace',
            fontSize: 12,
            letterSpacing: '0.15em',
            fontWeight: 700,
            marginTop: 4,
            color: '#111827',
          }}
        >
          {value}
        </span>
      )}
    </div>
  );
}
