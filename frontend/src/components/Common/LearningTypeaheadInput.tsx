import React, { useState, useRef, useEffect, useMemo } from 'react';
import { AlertTriangle, Check, Plus, ChevronDown, X } from 'lucide-react';

export interface LearningTypeaheadInputProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  attributeType: string; // e.g. "Brand", "Quality", "Shade", "Item Name", "Art No", "Fabric Type", "Category"
  placeholder?: string;
  required?: boolean;
  style?: React.CSSProperties;
  className?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}

export const LearningTypeaheadInput: React.FC<LearningTypeaheadInputProps> = ({
  value,
  onChange,
  options = [],
  attributeType,
  placeholder,
  required = false,
  style,
  className = 'form-input',
  disabled = false,
  autoFocus = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [confirmedValue, setConfirmedValue] = useState<string | null>(null);
  const [showWarningModal, setShowWarningModal] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close dropdown and shrink back to normal size when clicked outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setIsFocused(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const trimmedVal = (value || '').trim();

  // Check if current value matches an existing option exactly (case-insensitive)
  const isExistingMatch = useMemo(() => {
    if (!trimmedVal) return false;
    const lower = trimmedVal.toLowerCase();
    return options.some(opt => opt.toLowerCase() === lower);
  }, [options, trimmedVal]);

  // Filtered matching suggestions
  const filteredSuggestions = useMemo(() => {
    if (!trimmedVal) return options.slice(0, 8);
    const lower = trimmedVal.toLowerCase();
    return options
      .filter(opt => opt.toLowerCase().includes(lower))
      .slice(0, 8);
  }, [options, trimmedVal]);

  const hasMatches = filteredSuggestions.length > 0;
  // A word is genuinely "new / uncatalogued" ONLY when user has typed something that has zero matches among existing records
  const isZeroMatches = Boolean(trimmedVal && !isExistingMatch && !hasMatches);
  const isConfirmed = Boolean(trimmedVal && confirmedValue?.toLowerCase() === trimmedVal.toLowerCase());
  const isUnconfirmedNew = Boolean(trimmedVal && !isExistingMatch && !isConfirmed && trimmedVal.length >= 2);

  const handleSelect = (selectedVal: string) => {
    onChange(selectedVal);
    setConfirmedValue(selectedVal);
    setIsOpen(false);
    setIsFocused(false);
    setShowWarningModal(false);
    setHighlightIndex(-1);
  };

  const handleProceedNew = () => {
    setConfirmedValue(trimmedVal);
    setIsOpen(false);
    setIsFocused(false);
    setShowWarningModal(false);
  };

  const handleCancelNew = () => {
    onChange('');
    setConfirmedValue(null);
    setIsOpen(false);
    setShowWarningModal(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      setHighlightIndex(prev => (prev + 1 < filteredSuggestions.length ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      setHighlightIndex(prev => (prev - 1 >= 0 ? prev - 1 : filteredSuggestions.length - 1));
    } else if (e.key === 'Enter') {
      if (isOpen && highlightIndex >= 0 && filteredSuggestions[highlightIndex]) {
        e.preventDefault();
        handleSelect(filteredSuggestions[highlightIndex]);
      } else if (isUnconfirmedNew) {
        // User typed a non-catalog word and hit Enter -> show warning confirmation
        e.preventDefault();
        setShowWarningModal(true);
      } else {
        setIsOpen(false);
        setIsFocused(false);
      }
    } else if (e.key === 'Tab') {
      if (isUnconfirmedNew) {
        setConfirmedValue(trimmedVal);
      }
      setIsOpen(false);
      setIsFocused(false);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      setIsFocused(false);
      setShowWarningModal(false);
      setHighlightIndex(-1);
    }
  };

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        minHeight: 36,
        zIndex: isFocused ? 90 : 1,
      }}
    >
      {/* Inner expanding box: gets larger when typing, smoothly shrinks back when finished */}
      <div
        style={{
          position: isFocused ? 'absolute' : 'relative',
          top: 0,
          left: 0,
          width: isFocused ? 'max(100%, 300px)' : '100%',
          zIndex: isFocused ? 90 : 1,
          transition: 'width 0.18s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.18s ease',
          boxShadow: isFocused ? '0 10px 28px rgba(0, 0, 0, 0.16)' : 'none',
          borderRadius: 6,
          background: '#ffffff',
        }}
      >
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <input
            ref={inputRef}
            type="text"
            className={className}
            style={{
              height: isFocused ? 38 : 36,
              padding: isFocused ? '6px 28px 6px 10px' : '4px 26px 4px 8px',
              fontSize: isFocused ? 13.5 : 12.5,
              width: '100%',
              borderColor: isUnconfirmedNew ? '#f59e0b' : isConfirmed ? '#10b981' : isFocused ? 'var(--color-brand)' : undefined,
              background: isUnconfirmedNew ? '#fffdf7' : '#ffffff',
              transition: 'height 0.15s ease, font-size 0.15s ease, border-color 0.15s ease',
              ...style,
            }}
            placeholder={placeholder || `Select or type ${attributeType}...`}
            value={value || ''}
            onChange={e => {
              const nextVal = e.target.value;
              onChange(nextVal);
              setIsOpen(true);
              setHighlightIndex(-1);
              if (confirmedValue && nextVal.trim().toLowerCase() !== confirmedValue.toLowerCase()) {
                setConfirmedValue(null);
              }
            }}
            onFocus={() => {
              setIsFocused(true);
              setIsOpen(true);
            }}
            onBlur={e => {
              if (containerRef.current && containerRef.current.contains(e.relatedTarget as Node)) {
                return;
              }
              setIsFocused(false);
              // If blurred with an uncatalogued brand/shade/quality that has zero matches, prompt warning
              if (isZeroMatches && !isConfirmed && trimmedVal.length >= 2) {
                setShowWarningModal(true);
              }
            }}
            onKeyDown={handleKeyDown}
            required={required}
            disabled={disabled}
            autoFocus={autoFocus}
          />

          {/* Status indicator on right of input */}
          <div style={{ position: 'absolute', right: 8, display: 'flex', alignItems: 'center' }}>
            {isExistingMatch || isConfirmed ? (
              <span title={`Matched in ${attributeType} Master`} style={{ display: 'flex', alignItems: 'center', color: '#059669' }}>
                <Check size={14} color="#059669" />
              </span>
            ) : isUnconfirmedNew ? (
              <button
                type="button"
                onClick={() => setShowWarningModal(true)}
                title={`New ${attributeType} — Click to verify`}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  color: '#d97706',
                }}
              >
                <AlertTriangle size={14} color="#d97706" />
              </button>
            ) : (
              <ChevronDown size={13} style={{ opacity: 0.4, pointerEvents: 'none' }} />
            )}
          </div>
        </div>

        {/* Floating Suggestions Dropdown */}
        {isOpen && (
          <div style={{
            position: 'absolute',
            top: 'calc(100% + 2px)',
            left: 0,
            right: 0,
            zIndex: 100,
            background: '#ffffff',
            borderRadius: 6,
            border: '1px solid var(--color-border)',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)',
            maxHeight: 200,
            overflowY: 'auto',
          }}>
            {/* Case 1: Matching Suggestions Exist */}
            {hasMatches ? (
              <>
                {filteredSuggestions.map((opt, idx) => {
                  const isHighlighted = highlightIndex === idx;
                  const isSelected = opt.toLowerCase() === trimmedVal.toLowerCase();

                  return (
                    <div
                      key={opt}
                      onClick={() => handleSelect(opt)}
                      style={{
                        padding: '8px 10px',
                        fontSize: 12.5,
                        cursor: 'pointer',
                        background: isHighlighted ? 'var(--color-bg-subtle)' : isSelected ? '#f0fdf4' : '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        borderBottom: '1px solid #f1f5f9',
                      }}
                      onMouseEnter={() => setHighlightIndex(idx)}
                    >
                      <span style={{ fontWeight: isSelected ? 700 : 500, color: '#0f172a' }}>
                        {opt}
                      </span>
                      {isSelected && <Check size={13} color="var(--color-brand)" />}
                    </div>
                  );
                })}

                {/* If user typed a custom value that does not match any suggestion exactly */}
                {trimmedVal && !isExistingMatch && (
                  <div
                    onClick={() => handleProceedNew()}
                    style={{
                      padding: '8px 10px',
                      fontSize: 11.5,
                      color: '#92400e',
                      background: '#fffbeb',
                      borderTop: '1px solid #fde68a',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontWeight: 600,
                    }}
                  >
                    <Plus size={12} />
                    <span>Use &ldquo;{trimmedVal}&rdquo; as new {attributeType}</span>
                  </div>
                )}
              </>
            ) : trimmedVal ? (
              /* Case 2: Zero Matches Found (User typed a genuinely new name) */
              <div style={{ padding: '10px 12px', background: '#fffbeb', borderRadius: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#92400e', fontWeight: 600, fontSize: 12 }}>
                  <AlertTriangle size={14} color="#d97706" />
                  <span>New {attributeType}</span>
                </div>
                <div style={{ fontSize: 11.5, color: '#78350f', margin: '4px 0 8px' }}>
                  &ldquo;{trimmedVal}&rdquo; is not in your master catalog.
                </div>
                <button
                  type="button"
                  onClick={() => handleProceedNew()}
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    background: '#d97706',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: 4,
                    fontSize: 11.5,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 5,
                  }}
                >
                  <Plus size={12} /> Proceed with &ldquo;{trimmedVal}&rdquo;
                </button>
              </div>
            ) : (
              <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--color-text-muted)', textAlign: 'center' }}>
                No master {attributeType.toLowerCase()}s found.
              </div>
            )}
          </div>
        )}

        {/* Prominent Warning Modal when a new unconfirmed word is entered */}
        {showWarningModal && isUnconfirmedNew && (
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              left: 0,
              zIndex: 150,
              width: 'max-content',
              minWidth: 280,
              maxWidth: 340,
              background: '#ffffff',
              border: '1.5px solid #f59e0b',
              borderRadius: 8,
              boxShadow: '0 12px 30px -4px rgba(217, 119, 6, 0.25), 0 4px 12px rgba(0,0,0,0.08)',
              padding: '12px 14px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <div style={{ background: '#fef3c7', padding: 5, borderRadius: 6, color: '#d97706', display: 'flex' }}>
                  <AlertTriangle size={16} />
                </div>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#92400e' }}>
                  New {attributeType} Warning
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowWarningModal(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 2 }}
              >
                <X size={14} />
              </button>
            </div>

            <div style={{ fontSize: 12, color: '#334155', lineHeight: 1.45, marginBottom: 12 }}>
              <span style={{ fontWeight: 600, color: '#0f172a' }}>&ldquo;{trimmedVal}&rdquo;</span> is not in your master catalog.
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                Click <strong>Proceed</strong> to confirm and learn it into Master Data, or <strong>Change</strong> to correct a typo.
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={handleCancelNew}
                style={{
                  padding: '5px 10px',
                  fontSize: 11.5,
                  fontWeight: 600,
                  background: '#f1f5f9',
                  border: '1px solid #cbd5e1',
                  borderRadius: 5,
                  color: '#475569',
                  cursor: 'pointer',
                }}
              >
                Change
              </button>
              <button
                type="button"
                onClick={handleProceedNew}
                style={{
                  padding: '5px 12px',
                  fontSize: 11.5,
                  fontWeight: 600,
                  background: '#d97706',
                  border: 'none',
                  borderRadius: 5,
                  color: '#ffffff',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                <Plus size={13} /> Proceed
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LearningTypeaheadInput;
