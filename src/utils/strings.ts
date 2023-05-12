/* eslint-disable unicorn/no-abusive-eslint-disable */
/* eslint-disable */
interface String {
  hexify(padding: number, prepend0x: boolean): string
  toCamelCase(): string
  capitalize(): string
}

String.prototype.hexify = function (padding: number, prepend0x: boolean): string {
  let str: string = this as string
  str = str.trim().toLowerCase()
  str = str.replace(/[^\da-fx]+/g, '')
  if (str.startsWith('0x')) {
    str = str.slice(2, str.length)
  }

  return (prepend0x ? '0x' : '') + str.padStart(padding * 2, '0')
}

String.prototype.toCamelCase = function (): string {
  return this.replace(/([A-Z])/g, '_$1').toLowerCase()
}

String.prototype.capitalize = function (): string {
  return this.charAt(0).toUpperCase() + this.slice(1)
}
