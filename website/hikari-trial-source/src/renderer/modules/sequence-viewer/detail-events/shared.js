function eventTargetsElement(event, element) {
  const target = event?.target || null;
  return Boolean(target && element && (target === element || element.contains?.(target)));
}

export { eventTargetsElement };
