import axios, {AxiosInstance} from 'axios'

class ApiService {
  api: AxiosInstance
  BASE_URL!: string
  JWT!: string

  constructor(baseURL: string) {
    this.api = axios.create({
      baseURL,
    })
  }

  async operatorLogin() {
    if (!process.env.OPERATOR_API_KEY) throw 'OPERATOR_API_KEY env is required'

    const res = await this.api.post(`/v1/auth/operator`, {
      hash: process.env.OPERATOR_API_KEY,
    })

    this.JWT = res!.data.accessToken
    if (typeof this.JWT === 'undefined') {
      throw 'Failed to authorize as an operator'
    }

    // console.log(`process.env.OPERATOR_API_KEY = ${process.env.OPERATOR_API_KEY}`)
    console.log(`this.JWT = ${this.JWT}`)
  }

  // getJob
}

export default ApiService
