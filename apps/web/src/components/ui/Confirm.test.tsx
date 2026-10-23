import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { ConfirmProvider, useConfirm } from './Confirm';

function Demo() {
  const ask = useConfirm();
  const [result, setResult] = useState('none');
  return (
    <>
      <button
        onClick={async () =>
          setResult(
            (await ask({
              title: 'Delete the route?',
              message: 'It cannot be undone.',
              confirmLabel: 'Delete route',
              danger: true,
            }))
              ? 'yes'
              : 'no',
          )
        }
      >
        Go
      </button>
      <p data-testid="result">{result}</p>
    </>
  );
}

describe('ConfirmProvider', () => {
  it('asks first, and only a click on the confirm button says yes', async () => {
    const user = userEvent.setup();
    render(
      <ConfirmProvider>
        <Demo />
      </ConfirmProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Go' }));
    expect(await screen.findByText('It cannot be undone.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByTestId('result')).toHaveTextContent('no');

    await user.click(screen.getByRole('button', { name: 'Go' }));
    await user.click(await screen.findByRole('button', { name: 'Delete route' }));
    expect(screen.getByTestId('result')).toHaveTextContent('yes');
  });
});
