const crypto = require('crypto')
const encryptionType = 'aes-256-cbc'
const encryptionEncoding = 'base64'
const bufferEncryption = 'utf8'

export default class AesEncryption {
  AesKey: string
  AesIV: string

  constructor(key: string, iv: string) {
    this.AesKey = key
    this.AesIV = iv
  }

  encrypt(val: string): string {
    const key = Buffer.concat([Buffer.from(this.AesKey, bufferEncryption)], 32)
    const iv = Buffer.concat([Buffer.from(this.AesIV, bufferEncryption)], 16)
    const cipher = crypto.createCipheriv(encryptionType, key, iv)
    let encrypted = cipher.update(val, bufferEncryption, encryptionEncoding)
    encrypted += cipher.final(encryptionEncoding)
    return encrypted
  }

  decrypt(base64String: string): string {
    const buff = Buffer.from(base64String, encryptionEncoding)
    const key = Buffer.concat([Buffer.from(this.AesKey, bufferEncryption)], 32)
    const iv = Buffer.concat([Buffer.from(this.AesIV, bufferEncryption)], 16)
    const decipher = crypto.createDecipheriv(encryptionType, key, iv)
    const deciphered: string = decipher.update(buff).toString() + decipher.final().toString()
    return deciphered
  }
}
