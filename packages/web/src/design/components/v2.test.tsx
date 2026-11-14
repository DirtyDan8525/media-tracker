import { cfSetFor, CF_SETS, ratingColor, THEMES } from '@media-tracker/shared';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CfSetContext, ThemeColorsContext } from '../ThemeContext';
import { contrast } from '../theme';
import { CountUp } from './CountUp';
import { CoverBackdrop } from './CoverBackdrop';
import { RatingBadge } from './RatingBadge';

/** jsdom reports inline colours as rgb(r, g, b); the theme helpers want #rrggbb. */
function hex(rgb: string): string {
  const m = /rgb\((\d+), (\d+), (\d+)\)/.exec(rgb);
  if (!m) return rgb;
  return '#' + [m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('');
}

/** A matchMedia that answers only the given reduced-motion setting (widths fall back to false). */
function stubMotion(pref: 'reduce' | 'no-preference') {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes(`prefers-reduced-motion: ${pref}`),
    media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
    dispatchEvent: () => true,
  }));
}

describe('CoverBackdrop', () => {
  it('renders nothing without a src', () => {
    const { container, rerender } = render(<CoverBackdrop src={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<CoverBackdrop src="" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is decorative: aria-hidden with an empty-alt blurred image', () => {
    const { container } = render(<CoverBackdrop src="https://img.example/c.jpg" className="extra" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute('aria-hidden', 'true');
    expect(root).toHaveClass('backdrop', 'extra');
    const img = root.querySelector('img')!;
    expect(img).toHaveAttribute('src', 'https://img.example/c.jpg');
    expect(img).toHaveAttribute('alt', '');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});

describe('RatingBadge rating-scale colouring', () => {
  it('10 uses the high rating colour and 1 the low one', () => {
    const cf = CF_SETS.Midnight!;
    render(<CfSetContext.Provider value={cf}><RatingBadge rating={10} /><RatingBadge rating={1} /></CfSetContext.Provider>);
    expect(hex(screen.getByLabelText('Rating 10.0').style.background)).toBe(cf.high);
    expect(hex(screen.getByLabelText('Rating 1.0').style.background)).toBe(cf.low);
  });

  it.each(Object.keys(THEMES))('%s: the label passes 4.5:1 on the badge at 1, 5.5 and 10', (name) => {
    const cf = cfSetFor(name);
    const colors = THEMES[name]!;
    render(
      <ThemeColorsContext.Provider value={colors}>
        <CfSetContext.Provider value={cf}>
          <RatingBadge rating={1} /><RatingBadge rating={5.5} /><RatingBadge rating={10} />
        </CfSetContext.Provider>
      </ThemeColorsContext.Provider>,
    );
    for (const r of [1, 5.5, 10]) {
      const badge = screen.getByLabelText(`Rating ${r === 5.5 ? '5.5' : `${r}.0`}`);
      const bg = hex(badge.style.background);
      expect(bg).toBe(ratingColor(r, cf));
      const fg = hex(badge.style.color);
      expect(Object.values(colors), 'label colour is a theme role').toContain(fg);
      expect(contrast(fg, bg), `${name} @ ${r}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('CountUp', () => {
  it('shows the final rating at once under reduced motion', () => {
    stubMotion('reduce');
    const { container } = render(<CountUp value={9.5} />);
    expect(container.querySelector('[aria-hidden="true"]')).toHaveTextContent(/^9\.5$/);
    expect(container.querySelector('.sr-only')).toHaveTextContent(/^9\.5$/);
  });

  it('animates from `from` to the value, with the real value for screen readers throughout', async () => {
    stubMotion('no-preference');
    const { container } = render(<CountUp value={9.5} from={2} />);
    const visible = container.querySelector('[aria-hidden="true"]')!;
    const sr = container.querySelector('.sr-only')!;
    expect(sr).toHaveTextContent('9.5');
    expect(visible).toHaveTextContent('2.0');
    await waitFor(() => expect(visible).toHaveTextContent(/^9\.5$/), { timeout: 3000 });
  });

  it('keeps two decimals for a hundredths rating', () => {
    stubMotion('reduce');
    const { container } = render(<CountUp value={8.25} />);
    expect(container.querySelector('[aria-hidden="true"]')).toHaveTextContent(/^8\.25$/);
  });
});
