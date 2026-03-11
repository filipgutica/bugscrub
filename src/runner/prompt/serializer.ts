export const serializePrompt = ({
  sections
}: {
  sections: string[]
}): string => {
  return sections.join('\n\n')
}
