import {
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
} from "react";
import { createPortal } from "react-dom";

type ModalProps = {
  children: ReactNode;
  className?: string;
  closeLabel?: string;
  disableDismiss?: boolean;
  footer?: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>;
  inline?: boolean;
  onClose: () => void;
  subtitle?: ReactNode;
  title: ReactNode;
};

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function Modal({
  children,
  className,
  closeLabel = "Close dialog",
  disableDismiss = false,
  footer,
  initialFocusRef,
  inline = false,
  onClose,
  subtitle,
  title,
}: ModalProps) {
  const titleId = useId();
  const subtitleId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<Element | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement;

    const focusTarget =
      initialFocusRef?.current ??
      dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
      closeButtonRef.current;

    dialogRef.current?.scrollIntoView?.({
      block: "nearest",
      inline: "nearest",
    });
    focusTarget?.focus({ preventScroll: true });

    return () => {
      if (previousFocusRef.current instanceof HTMLElement) {
        previousFocusRef.current.focus({ preventScroll: true });
      }
    };
  }, [initialFocusRef]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || disableDismiss) {
        return;
      }

      event.preventDefault();
      onClose();
    };

    document.addEventListener("keydown", onKeyDown);

    return () => document.removeEventListener("keydown", onKeyDown);
  }, [disableDismiss, onClose]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const modalContent = (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !disableDismiss) {
          onClose();
        }
      }}
    >
      <section
        aria-describedby={subtitle ? subtitleId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className={["modal-dialog", className].filter(Boolean).join(" ")}
        ref={dialogRef}
        role="dialog"
      >
        <header className="modal-header">
          <div className="modal-heading">
            <h2 id={titleId}>{title}</h2>
            {subtitle ? <p id={subtitleId}>{subtitle}</p> : null}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="ghost-button compact-button modal-close-button"
            aria-label={closeLabel}
            disabled={disableDismiss}
            onClick={onClose}
          >
            X
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-footer">{footer}</footer> : null}
      </section>
    </div>
  );

  return inline ? modalContent : createPortal(modalContent, document.body);
}
