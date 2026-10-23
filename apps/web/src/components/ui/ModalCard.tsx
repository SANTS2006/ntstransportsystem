import { Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './Button';
import { Dialog } from './Dialog';

/**
 * A short "add something" form that lives in a pop-up: one button on the page opens it, and the
 * page keeps its list in view. The owner of the form closes it (`onOpenChange(false)`) when the
 * save works.
 */
export function ModalCard({
  title,
  open,
  onOpenChange,
  children,
}: {
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <>
      <div className="flex justify-end">
        <Button onClick={() => onOpenChange(true)}>
          <Plus aria-hidden="true" className="size-4" strokeWidth={1.8} />
          {title}
        </Button>
      </div>
      <Dialog open={open} title={title} onClose={() => onOpenChange(false)}>
        <div className="max-h-[70vh] overflow-y-auto pr-1">{children}</div>
      </Dialog>
    </>
  );
}
