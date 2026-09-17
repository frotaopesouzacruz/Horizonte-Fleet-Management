"use client";

import * as React from "react";
import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/** Returns up to `max` uppercase initials from a person or company name. */
export function getInitials(name: string | null | undefined, max = 2): string {
  if (!name) return "";
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0 && !/^(da|de|do|das|dos|e|di|du|von|van)$/i.test(part));
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, max).toUpperCase();
  const first = parts[0][0];
  const last = parts[parts.length - 1][0];
  return (max === 1 ? first : first + last).toUpperCase();
}

export const avatarVariants = cva(
  "relative inline-flex shrink-0 select-none overflow-hidden bg-primary-soft align-middle",
  {
    variants: {
      size: {
        xs: "size-5 text-caption",
        sm: "size-6 text-caption",
        md: "size-8 text-body-sm",
        lg: "size-10 text-body",
      },
      shape: {
        circle: "rounded-full",
        square: "rounded-sm",
      },
    },
    defaultVariants: { size: "md", shape: "circle" },
  },
);

export type AvatarSize = NonNullable<VariantProps<typeof avatarVariants>["size"]>;

type AvatarContextValue = { size: AvatarSize };
const AvatarContext = React.createContext<AvatarContextValue>({ size: "md" });

export interface AvatarProps
  extends React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>,
    VariantProps<typeof avatarVariants> {}

export const Avatar = React.forwardRef<React.ComponentRef<typeof AvatarPrimitive.Root>, AvatarProps>(
  function Avatar({ className, size, shape, ...props }, ref) {
    const resolvedSize = size ?? "md";
    const ctx = React.useMemo(() => ({ size: resolvedSize }), [resolvedSize]);
    return (
      <AvatarContext.Provider value={ctx}>
        <AvatarPrimitive.Root
          ref={ref}
          data-size={resolvedSize}
          className={cn(avatarVariants({ size: resolvedSize, shape }), className)}
          {...props}
        />
      </AvatarContext.Provider>
    );
  },
);

export const AvatarImage = React.forwardRef<
  React.ComponentRef<typeof AvatarPrimitive.Image>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(function AvatarImage({ className, ...props }, ref) {
  return (
    <AvatarPrimitive.Image ref={ref} className={cn("aspect-square size-full object-cover", className)} {...props} />
  );
});

export interface AvatarFallbackProps extends React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback> {
  /** Name used to derive initials when no children are passed. */
  name?: string | null;
}

export const AvatarFallback = React.forwardRef<
  React.ComponentRef<typeof AvatarPrimitive.Fallback>,
  AvatarFallbackProps
>(function AvatarFallback({ className, name, children, ...props }, ref) {
  const { size } = React.useContext(AvatarContext);
  const content = children ?? getInitials(name, size === "xs" ? 1 : 2);
  return (
    <AvatarPrimitive.Fallback
      ref={ref}
      className={cn(
        "flex size-full items-center justify-center rounded-[inherit] bg-primary-soft font-semibold leading-none text-primary-soft-fg",
        className,
      )}
      {...props}
    >
      {content}
    </AvatarPrimitive.Fallback>
  );
});

/* -------------------------------------------------------------------------- */

export interface AvatarGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Maximum avatars rendered before collapsing into "+N". */
  max?: number;
  /** Total count when the children are only a subset of the real list. */
  total?: number;
  size?: AvatarSize;
}

const groupOverlap: Record<AvatarSize, string> = {
  xs: "-space-x-1.5",
  sm: "-space-x-2",
  md: "-space-x-2.5",
  lg: "-space-x-3",
};

/**
 * AvatarGroup — overlapping avatars with a "+N" overflow indicator.
 * Children should be <Avatar>; `size` is applied to every child.
 */
export const AvatarGroup = React.forwardRef<HTMLDivElement, AvatarGroupProps>(function AvatarGroup(
  { className, max = 4, total, size = "md", children, ...props },
  ref,
) {
  const items = React.Children.toArray(children).filter(React.isValidElement) as React.ReactElement<AvatarProps>[];
  const visible = items.slice(0, max);
  const count = total ?? items.length;
  const overflow = Math.max(0, count - visible.length);

  return (
    <div ref={ref} className={cn("flex items-center", groupOverlap[size], className)} {...props}>
      {visible.map((child, index) =>
        React.cloneElement(child, {
          key: child.key ?? index,
          size,
          className: cn("ring-2 ring-surface", child.props.className),
        }),
      )}
      {overflow > 0 ? (
        <span
          className={cn(
            avatarVariants({ size, shape: "circle" }),
            "items-center justify-center bg-secondary font-medium text-fg-secondary ring-2 ring-surface tabular-nums",
          )}
          aria-label={`Mais ${overflow}`}
          title={`Mais ${overflow}`}
        >
          +{overflow}
        </span>
      ) : null}
    </div>
  );
});
