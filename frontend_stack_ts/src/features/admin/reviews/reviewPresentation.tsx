const EXCERPT_LENGTH = 120

export const commentExcerpt = (comment: string | null): string => {
  if (comment === null) return "No comment"
  const flat = comment.replace(/\s+/gu, " ")
  return flat.length <= EXCERPT_LENGTH ? flat : `${flat.slice(0, EXCERPT_LENGTH).trimEnd()}...`
}
