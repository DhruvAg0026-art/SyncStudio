import { useCallback, useEffect, useState } from "react"
import * as Y from "yjs"

const VERSION_LIMIT = 30
const MAX_SNAPSHOT_BYTES = 100 * 1024

function cloneXmlNode(node) {
  if (node instanceof Y.XmlText) {
    const clone = new Y.XmlText()
    clone.applyDelta(node.toDelta())
    return clone
  }
  if (node instanceof Y.XmlElement) {
    const clone = new Y.XmlElement(node.nodeName)
    for (const [name, value] of Object.entries(node.getAttributes())) {
      clone.setAttribute(name, value)
    }
    clone.insert(0, node.toArray().map(cloneXmlNode))
    return clone
  }
  throw new Error("This document contains a node type that cannot be snapshotted.")
}

function encodeBase64(bytes) {
  let binary = ""
  const chunkSize = 8192
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

function createSnapshot(ydoc, mode, content) {
  const snapshot = new Y.Doc()
  if (mode === "code") {
    snapshot.getText("monaco").insert(0, ydoc.getText("monaco").toString())
  } else {
    const source = ydoc.getXmlFragment("doc")
    snapshot.getXmlFragment("doc").insert(0, source.toArray().map(cloneXmlNode))
  }
  const title = ydoc.getText("title").toString()
  if (title) snapshot.getText("title").insert(0, title)
  const encoded = Y.encodeStateAsUpdate(snapshot)
  if (encoded.byteLength > MAX_SNAPSHOT_BYTES) {
    snapshot.destroy()
    throw new Error("This version exceeds the 100 KB snapshot limit.")
  }
  const update = encodeBase64(encoded)
  snapshot.destroy()
  return {
    id: crypto.randomUUID(),
    author: content.author,
    createdAt: Date.now(),
    mode,
    update,
    content: content.value,
  }
}

export default function VersionHistory({ ydoc, mode, user, editor }) {
  const [open, setOpen] = useState(false)
  const [versions, setVersions] = useState([])
  const [selectedVersion, setSelectedVersion] = useState(null)
  const [error, setError] = useState("")

  const saveSnapshot = useCallback(() => {
    try {
      const value = mode === "code" ? ydoc.getText("monaco").toString() : editor?.getJSON()
      if (value == null) {
        setError("The editor is not ready to save a version.")
        return
      }
      const version = createSnapshot(ydoc, mode, {
        author: user?.name || "Guest",
        value,
      })
      const sharedVersions = ydoc.getArray("versions")
      ydoc.transact(() => {
        sharedVersions.push([version])
        if (sharedVersions.length > VERSION_LIMIT) {
          sharedVersions.delete(0, sharedVersions.length - VERSION_LIMIT)
        }
      })
      setError("")
      setSelectedVersion(version)
      setOpen(true)
    } catch (snapshotError) {
      setError(snapshotError.message || "Could not save this version.")
    }
  }, [ydoc, mode, user, editor])

  useEffect(() => {
    const sharedVersions = ydoc.getArray("versions")
    const updateVersions = () => {
      setVersions(sharedVersions.toArray().filter((version) =>
        version && typeof version.id === "string" && typeof version.update === "string"
      ))
    }
    sharedVersions.observe(updateVersions)
    updateVersions()
    return () => sharedVersions.unobserve(updateVersions)
  }, [ydoc])

  useEffect(() => {
    let timer
    const scheduleSnapshot = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        saveSnapshot()
      }, 10 * 60 * 1000)
    }
    const text = mode === "code" ? ydoc.getText("monaco") : null
    const onDocUpdate = () => scheduleSnapshot()

    if (text) text.observe(onDocUpdate)
    else if (editor) editor.on("update", onDocUpdate)

    return () => {
      clearTimeout(timer)
      if (text) text.unobserve(onDocUpdate)
      else if (editor) editor.off("update", onDocUpdate)
    }
  }, [ydoc, mode, editor, saveSnapshot])

  const restore = (version) => {
    if (!window.confirm("Restore this version for everyone in the room?")) return
    if (version.mode !== mode) {
      setError("This version belongs to a different editor mode.")
      return
    }
    if (mode === "code") {
      const text = ydoc.getText("monaco")
      ydoc.transact(() => {
        if (text.length) text.delete(0, text.length)
        if (version.content) text.insert(0, version.content)
      })
    } else if (editor && version.content) {
      editor.commands.setContent(version.content)
    }
    setError("")
  }

  const preview = (version) => {
    if (version.mode === "code") return String(version.content || "")
    const blocks = []
    const visit = (node) => {
      if (typeof node.text === "string") blocks.push(node.text)
      if (Array.isArray(node.content)) node.content.forEach(visit)
    }
    if (version.content?.content) version.content.content.forEach(visit)
    return blocks.join(" ")
  }

  return (
    <div className="version-history">
      <button type="button" className="version-toggle" onClick={() => setOpen((value) => !value)}>
        History
      </button>
      {open && (
        <aside className="version-panel" aria-label="Version history">
          <div className="version-panel-header">
            <h2>Version history</h2>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close version history">×</button>
          </div>
          <button type="button" className="version-save" onClick={saveSnapshot}>Save version</button>
          {error && <p className="version-error" role="alert">{error}</p>}
          <ul>
            {versions.filter((version) => version.mode === mode).slice().reverse().map((version) => (
              <li key={version.id}>
                <button
                  type="button"
                  className={selectedVersion?.id === version.id ? "version-item selected" : "version-item"}
                  onClick={() => setSelectedVersion(version)}
                >
                  <strong>{version.author}</strong>
                  <time>{new Date(version.createdAt).toLocaleString()}</time>
                </button>
              </li>
            ))}
          </ul>
          {selectedVersion && (
            <div className="version-preview">
              <pre>{preview(selectedVersion).slice(0, 5000)}</pre>
              <button type="button" onClick={() => restore(selectedVersion)}>Restore version</button>
            </div>
          )}
        </aside>
      )}
    </div>
  )
}
