declare module 'bwip-js' {
  export function toBuffer(opts: any): Promise<Buffer>;
  export function toSVG(opts: any): string;
  const bwipjs: {
    toBuffer(opts: any): Promise<Buffer>;
    toSVG(opts: any): string;
  };
  export default bwipjs;
}
