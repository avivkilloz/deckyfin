import { VFC, useEffect, useRef } from "react";
import { TextField } from "@decky/ui";

interface Props {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  style?: React.CSSProperties;
}

export const CompactTextField: VFC<Props> = ({
  value,
  onChange,
  placeholder,
  style,
}) => {
  const ref = useRef<any>(null);

  useEffect(() => {
    const el = ref.current?.m_elInput as HTMLElement | undefined;
    if (!el) return;
    el.style.padding = "4px 6px";
    el.style.fontSize = "0.85em";
    el.style.minHeight = "unset";
    el.style.height = "auto";
    el.style.minWidth = "0";
    el.style.boxSizing = "border-box";
    el.style.borderRadius = "4px";
  }, []);

  return (
    <TextField
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      style={style}
      {...({ ref } as any)}
    />
  );
};
