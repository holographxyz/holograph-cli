/* eslint-disable unicorn/no-abusive-eslint-disable */
/* eslint-disable */
interface Number {
  hexify(padding: number | null, prepend0x: boolean): string
}

Number.prototype.hexify = function (padding: number | null, prepend0x: boolean): string {
  let str: string = this.toString(16)
  str = str.trim().toLowerCase()
  if (str.startsWith('0x')) {
    str = str.slice(2, str.length)
  }

  if (padding !== null) {
    str = str.padStart((padding as number) * 2, '0')
  }

  return (prepend0x ? '0x' : '') + str
}
