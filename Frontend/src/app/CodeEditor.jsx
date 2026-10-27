import { useEffect, useState } from "react"
import { Editor } from "@monaco-editor/react"
import { MonacoBinding } from "y-monaco"

export default function CodeEditor({ ydoc, provider }) {
  const [editor, setEditor] = useState(null)

  useEffect(() => {
    if (!editor) return

    const binding = new MonacoBinding(
      ydoc.getText("monaco"),
      editor.getModel(),
      new Set([editor]),
      provider.awareness
    )

    return () => binding.destroy()
  }, [editor, ydoc, provider])

  return (
    <Editor
      height="100%"
      defaultLanguage="javascript"
      theme="vs-dark"
      options={{ fontSize: 14, minimap: { enabled: false } }}
      onMount={(mountedEditor) => setEditor(mountedEditor)}
    />
  )
}
