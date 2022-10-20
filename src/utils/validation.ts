const addressValidator = /^0x[\da-f]{40}$/i
const tokenValidator = /^((0x[\da-f]{64})|(\d+))$/i
const portValidator = (port: number) => port >= 3000 && port <= 65535
export {addressValidator, tokenValidator, portValidator}
