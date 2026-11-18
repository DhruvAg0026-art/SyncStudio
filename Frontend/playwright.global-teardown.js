import { rm } from "node:fs/promises"
import process from "node:process"

const dataDirectory = process.env.SYNCSTUDIO_E2E_DATA_DIR
if (dataDirectory) {
  await rm(dataDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
}
