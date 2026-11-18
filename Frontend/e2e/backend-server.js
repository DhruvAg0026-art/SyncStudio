import { spawn } from "node:child_process"
import { rm } from "node:fs/promises"
import { resolve } from "node:path"
import process from "node:process"

const backendDirectory = resolve("../Backend")
const backend = spawn(process.execPath, ["server.js"], {
  cwd: backendDirectory,
  env: process.env,
  stdio: "inherit",
})

let stopping = false

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (stopping) return
    stopping = true
    backend.kill("SIGTERM")
  })
}

backend.on("error", (error) => {
  console.error("Could not start the E2E backend:", error)
  process.exitCode = 1
})

backend.on("exit", async (code, signal) => {
  const dataDirectory = process.env.DATA_DIR
  if (dataDirectory) {
    try {
      await rm(dataDirectory, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 500,
      })
    } catch (error) {
      console.error("Could not remove the temporary E2E database:", error)
      process.exitCode = 1
    }
  }
  if (!stopping) process.exitCode = code ?? (signal ? 1 : 0)
})
