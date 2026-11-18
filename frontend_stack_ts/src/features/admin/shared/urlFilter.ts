import { useEffect } from "react"
import { useSearchParams } from "react-router-dom"

export type UrlFilter<TValue extends string> = readonly [TValue, (value: TValue) => void]

export const useUrlFilter = <TValue extends string>(
  name: string,
  options: readonly Readonly<{ value: TValue }>[],
  fallback: TValue,
): UrlFilter<TValue> => {
  const [searchParams, setSearchParams] = useSearchParams()
  const raw = searchParams.get(name)
  const value = options.find((option) => option.value === raw)?.value ?? fallback
  const isUnknown = raw !== null && raw !== value

  useEffect(() => {
    if (!isUnknown) return
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current)
        params.delete(name)
        return params
      },
      { replace: true },
    )
  }, [isUnknown, name, setSearchParams])

  const setValue = (next: TValue): void => {
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current)
        if (next === fallback) params.delete(name)
        else params.set(name, next)
        return params
      },
      { replace: true },
    )
  }
  return [value, setValue]
}
