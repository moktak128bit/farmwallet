import React, { useState, useEffect, useRef } from "react";

export interface AutocompleteOption {
  value: string;
  label?: string;
  subLabel?: string;
  group?: string;
}

interface AutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (option: AutocompleteOption) => void;
  options: AutocompleteOption[];
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  renderOption?: (option: AutocompleteOption) => React.ReactNode;
}

export const Autocomplete: React.FC<AutocompleteProps> = ({
  value,
  onChange,
  onSelect,
  options,
  placeholder,
  className,
  autoFocus,
  disabled,
  renderOption
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 외부 클릭 시 닫기
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // 옵션이 변경되면 하이라이트 초기화
  useEffect(() => {
    setHighlightedIndex(-1);
  }, [options]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIsOpen(true);
      setHighlightedIndex((prev) => (prev + 1) % options.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIsOpen(true);
      setHighlightedIndex((prev) => (prev - 1 + options.length) % options.length);
    } else if (e.key === "Enter") {
      if (isOpen && highlightedIndex >= 0 && options[highlightedIndex]) {
        e.preventDefault();
        handleSelect(options[highlightedIndex]);
      }
    } else if (e.key === "Escape") {
      setIsOpen(false);
      inputRef.current?.blur();
    }
  };

  const handleSelect = (option: AutocompleteOption) => {
    onChange(option.value);
    onSelect?.(option);
    setIsOpen(false);
    setHighlightedIndex(-1);
  };

  return (
    <div className={`autocomplete-container ${className || ""}`} ref={containerRef} style={{ position: "relative" }}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => {
          if (options.length > 0) setIsOpen(true);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        style={{ width: "100%", padding: "6px 8px", fontSize: 14 }}
      />
      {isOpen && options.length > 0 && (
        <ul
          className="autocomplete-dropdown"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 1000,
            background: "var(--surface, #fff)",
            border: "1px solid var(--border, #ddd)",
            borderRadius: 4,
            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
            maxHeight: "240px",
            overflowY: "auto",
            marginTop: 4,
            padding: 0,
            margin: "4px 0 0 0",
            listStyle: "none"
          }}
        >
          {options.map((option, index) => {
            const isHighlighted = index === highlightedIndex;
            return (
              <li
                key={`${option.value}-${index}`}
                className={`autocomplete-item ${isHighlighted ? "highlighted" : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault(); // prevent blur
                  handleSelect(option);
                }}
                onMouseEnter={() => setHighlightedIndex(index)}
                style={{
                  padding: "8px 12px",
                  cursor: "pointer",
                  borderBottom: index < options.length - 1 ? "1px solid var(--border, #eee)" : "none",
                  backgroundColor: isHighlighted ? "var(--hover-bg, #f5f5f5)" : "transparent",
                  color: "var(--text, #000)"
                }}
              >
                {renderOption ? (
                  renderOption(option)
                ) : (
                  <div>
                    <div style={{ fontWeight: 500 }}>{option.value}</div>
                    {(option.label || option.subLabel) && (
                      <div style={{ fontSize: 12, color: "var(--muted, #666)", marginTop: 2 }}>
                        {[option.label, option.subLabel].filter(Boolean).join(" • ")}
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};


