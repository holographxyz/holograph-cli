export function lowerCaseAllStrings(input: any[], add?: string): any[] {
  const output = [...input]
  if (add !== undefined) {
    output.push(add)
  }

  for (let i = 0, l = output.length; i < l; i++) {
    if (typeof output[i] === 'string') {
      output[i] = (output[i] as string).toLowerCase()
    }
  }

  return output
}
