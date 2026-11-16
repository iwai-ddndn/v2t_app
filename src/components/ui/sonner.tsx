import { Toaster as Sonner, type ToasterProps } from 'sonner';

// M3 Snackbar: inverse-surface・角 4px・下部
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="bottom-center"
      offset={{ bottom: 'calc(env(safe-area-inset-bottom) + 120px)' }}
      mobileOffset={{ bottom: 'calc(env(safe-area-inset-bottom) + 120px)' }}
      toastOptions={{
        classNames: {
          toast: '!bg-inverse-surface !text-inverse-on-surface !border-0 !rounded-sm !shadow-lg !text-sm !gap-3 !min-h-12 !py-3',
          actionButton: '!bg-transparent !text-[color:var(--primary-container)] dark:!text-[color:var(--primary-container)] !font-medium !text-sm !h-9 !px-3',
          cancelButton: '!bg-transparent !text-inverse-on-surface/80 !text-sm !h-9',
        },
      }}
      {...props}
    />
  );
}
export { Toaster };
