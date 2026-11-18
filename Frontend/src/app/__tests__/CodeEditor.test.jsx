import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { createElement } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import * as Y from "yjs"

vi.doMock("@monaco-editor/react", () => ({
  Editor: () => createElement("textarea", { "aria-label": "Code editor" }),
}))

vi.doMock("../VersionHistory", () => ({
  default: () => null,
}))

vi.doMock("y-monaco", () => ({
  MonacoBinding: class {
    destroy() {}
  },
}))

const { default: CodeEditor } = await import("../CodeEditor")

describe("Code mode toolbar", () => {
  let ydoc
  const provider = {
    awareness: {
      getLocalState: () => ({ user: { name: "Ava" } }),
    },
  }

  afterEach(() => {
    ydoc?.destroy()
  })

  it("reads and writes the shared language setting", async () => {
    ydoc = new Y.Doc()
    render(<CodeEditor ydoc={ydoc} provider={provider} />)

    const language = screen.getByRole("combobox", { name: "Code language" })
    expect(language).toHaveValue("javascript")

    fireEvent.change(language, { target: { value: "python" } })
    expect(ydoc.getMap("settings").get("language")).toBe("python")

    act(() => ydoc.getMap("settings").set("language", "typescript"))
    await waitFor(() => expect(language).toHaveValue("typescript"))
  })

  it("opens the output panel from the toolbar", () => {
    ydoc = new Y.Doc()
    render(<CodeEditor ydoc={ydoc} provider={provider} />)

    fireEvent.click(screen.getByRole("button", { name: "Output" }))

    expect(screen.getByRole("region", { name: "Code output" })).toBeInTheDocument()
    expect(screen.getByText("Shared output")).toBeInTheDocument()
  })
})
