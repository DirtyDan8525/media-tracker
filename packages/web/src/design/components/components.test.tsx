import { CF_SETS } from '@media-tracker/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { BottomTabs } from './BottomTabs';
import { Button } from './Button';
import { CoverImage } from './CoverImage';
import { EmptyState } from './EmptyState';
import { IconButton } from './IconButton';
import { RatingBadge } from './RatingBadge';
import { Sheet } from './Sheet';
import { Skeleton } from './Skeleton';
import { StatusPill } from './StatusPill';
import { ToastProvider, useToast } from './Toast';

describe('design components: accessible names', () => {
  it('Button and IconButton', async () => {
    const onClick = vi.fn();
    render(<><Button onClick={onClick}>Save</Button><IconButton label="Search" icon="search" onClick={onClick} /></>);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('Sheet is a named dialog with a named close button, closes on Escape', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Button onClick={() => setOpen(true)}>Open</Button>
          <Sheet open={open} title="Add anime" onClose={() => setOpen(false)}><p>Body</p></Sheet>
        </>
      );
    }
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = screen.getByRole('dialog', { name: 'Add anime' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus();
  });

  it('CoverImage has alt text and a named fallback', () => {
    const { rerender } = render(<CoverImage src="https://img.example/c.jpg" alt="Frieren cover" />);
    const img = screen.getByRole('img', { name: 'Frieren cover' });
    fireEvent.error(img);
    expect(screen.getByRole('img', { name: 'Frieren cover' })).not.toHaveAttribute('src');
    rerender(<CoverImage src="" alt="Blue Train cover" square />);
    expect(screen.getByRole('img', { name: 'Blue Train cover' })).toHaveClass('cover--square');
  });

  it('RatingBadge is named and coloured by ratingColor', () => {
    render(<><RatingBadge rating={10} cf={CF_SETS.Midnight} /><RatingBadge rating={null} /></>);
    const badge = screen.getByLabelText('Rating 10.0');
    expect(badge).toHaveTextContent('10.0');
    expect(badge.style.background).toBe('rgb(31, 107, 69)'); // #1f6b45 = high
    expect(screen.getByLabelText('Unrated')).toBeInTheDocument();
  });

  it('RatingBadge shows up to two decimals without padding past one: 10.0, 9.5, 8.25', () => {
    render(<><RatingBadge rating={10} /><RatingBadge rating={9.5} /><RatingBadge rating={8.25} /><RatingBadge rating={7} /></>);
    expect(screen.getByLabelText('Rating 10.0')).toHaveTextContent(/^10\.0$/);
    expect(screen.getByLabelText('Rating 9.5')).toHaveTextContent(/^9\.5$/);
    expect(screen.getByLabelText('Rating 8.25')).toHaveTextContent(/^8\.25$/);
    expect(screen.getByLabelText('Rating 7.0')).toHaveTextContent(/^7\.0$/);
  });

  it('StatusPill shows the status', () => {
    render(<StatusPill status="On Hold" cf={CF_SETS.Midnight} />);
    const pill = screen.getByText('On Hold');
    expect(pill.style.background).toBe('rgb(74, 63, 28)'); // #4a3f1c
  });

  it('Skeleton is hidden from assistive tech', () => {
    const { container } = render(<Skeleton height={78} />);
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('EmptyState names its heading and action', async () => {
    const onAction = vi.fn();
    render(<EmptyState title="No anime yet" body="Add your first one." actionLabel="Add anime" onAction={onAction} />);
    expect(screen.getByRole('heading', { name: 'No anime yet' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add anime' }));
    expect(onAction).toHaveBeenCalled();
  });

  it('Toast announces through a status region', async () => {
    function Harness() {
      const toast = useToast();
      return <Button onClick={() => toast.show('Saved')}>Go</Button>;
    }
    render(<ToastProvider><Harness /></ToastProvider>);
    await userEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });

  it('BottomTabs: a named nav whose links are named', () => {
    render(
      <MemoryRouter initialEntries={['/list/movies']}>
        <BottomTabs lists={['anime', 'movies', 'tv', 'albums']} />
      </MemoryRouter>,
    );
    const nav = screen.getByRole('navigation', { name: 'Lists' });
    for (const name of ['Anime', 'Movies', 'TV', 'Albums', 'More']) {
      expect(within(nav).getByRole('link', { name })).toBeInTheDocument();
    }
    expect(within(nav).getByRole('link', { name: 'Movies' })).toHaveAttribute('aria-current', 'page');
  });
});

describe('CoverImage fluid', () => {
  it('fills its container: no inline width, the fluid class', () => {
    render(<><CoverImage src="https://img.example/a.jpg" alt="A cover" width={160} fluid /><CoverImage src={null} alt="B cover" fluid /></>);
    for (const el of [screen.getByRole('img', { name: 'A cover' }), screen.getByRole('img', { name: 'B cover' })]) {
      expect(el).toHaveClass('cover--fluid');
      expect(el.style.width).toBe('');
    }
  });
});
