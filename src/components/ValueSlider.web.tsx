import React, { useState } from 'react';
import type { ValueSliderProps } from './ValueSlider';
export function ValueSlider({
  value,
  min,
  max,
  step,
  label,
  valueText,
  disabled,
  onChange,
}: ValueSliderProps) {
  const [focused, setFocused] = useState(false);
  const position = ((value - min) / (max - min)) * 100;
  return (
    <div
      style={{
        position: 'relative',
        height: 44,
        margin: '0 12px',
        display: 'flex',
        alignItems: 'center',
        opacity: disabled ? 0.3 : 1,
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          width: '100%',
          height: 6,
          borderRadius: 6,
          background: '#3A4351',
        }}
      >
        <div
          style={{
            width: `${position}%`,
            height: 6,
            borderRadius: 6,
            background: 'linear-gradient(90deg,#8B5CF6,#C4ABFA)',
          }}
        />
      </div>
      <div
        aria-hidden
        style={{
          pointerEvents: 'none',
          position: 'absolute',
          left: `${position}%`,
          marginLeft: -12,
          width: 24,
          height: 24,
          boxSizing: 'border-box',
          borderRadius: 12,
          border: '5px solid #8B5CF6',
          background: '#E9DFFE',
          boxShadow: focused ? '0 0 0 5px #8B5CF63D' : '0 0 12px #8B5CF630',
        }}
      />
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        aria-valuetext={valueText}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          position: 'absolute',
          left: -12,
          width: 'calc(100% + 24px)',
          height: 44,
          margin: 0,
          opacity: 0,
          cursor: disabled ? 'default' : 'grab',
          touchAction: 'pan-y',
        }}
      />
    </div>
  );
}
