const addressValidator = /^0x[\da-f]{40}$/i
const numberValidator = /^\d{1,78}$/i
const tokenValidator = /^((0x[\da-f]{1,64})|(\d{1,78}))$/i
export {addressValidator, numberValidator, tokenValidator}
