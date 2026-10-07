import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Объединение классов в стиле shadcn/ui. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
