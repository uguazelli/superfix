import { forwardRef, type ComponentProps } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

export const buttonVariants = cva('button', {
  variants: { variant: { default: 'button-primary', outline: 'button-outline', ghost: 'button-ghost' } },
  defaultVariants: { variant: 'default' },
})

type ButtonProps = ComponentProps<'button'> & VariantProps<typeof buttonVariants>

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, type = 'button', ...props }, ref,
) {
  return <button ref={ref} type={type} className={cn(buttonVariants({ variant }), className)} {...props} />
})
