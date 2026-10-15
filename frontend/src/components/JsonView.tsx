import { useMemo } from "react";

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Pretty JSON with light syntax highlighting (input is escaped before tokens are wrapped). */
export default function JsonView({ value }: { value: unknown }) {
  const html = useMemo(() => {
    const json = escapeHtml(JSON.stringify(value, null, 2) ?? "");
    return json.replace(
      /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
      (m) => {
        let cls = "text-[#F2C38B]"; // number
        if (m.startsWith('"')) cls = /:$/.test(m) ? "text-cyan" : "text-[#B9E3A8]";
        else if (m === "true" || m === "false") cls = "text-[#C9A2F7]";
        else if (m === "null") cls = "text-ink-3";
        return `<span class="${cls}">${m}</span>`;
      },
    );
  }, [value]);
  return (
    <pre
      className="overflow-x-auto whitespace-pre-wrap break-words rounded-xl border border-line bg-night/70 p-3 font-mono text-[12px] leading-relaxed text-ink-2"
      style={{ unicodeBidi: "plaintext" }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
