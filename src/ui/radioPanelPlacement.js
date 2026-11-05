/** Reuse Radio controls in the phone sheet or desktop Context, in every theme. */
export function syncRadioPanelPlacement(doc) {
  if (!doc?.getElementById) return;
  const panel = doc.getElementById('radio-panel');
  const mobileRail = doc.body?.classList?.contains('mobile-shell') && doc.getElementById('right-context-rail');
  if (panel && mobileRail) {
    if (panel.parentElement !== mobileRail) mobileRail.append(panel);
    return;
  }
  const context = doc.getElementById('global-context-panel');
  const dock = doc.getElementById('context-radio-dock');
  const mini = doc.getElementById('context-radio-mini');
  const parent =
    context?.querySelector('.cyber-panel-body') ||
    context?.querySelector('.global-context-panel-inner');
  const header = context?.querySelector('.panel-header');
  if (!panel || !parent || !header || !dock || !mini) return;
  if (panel.parentElement !== parent) parent.append(panel);
  if (dock.parentElement !== header)
    header.insertBefore(dock, header.querySelector('.panel-collapse-btn'));
  if (mini.parentElement !== dock) dock.append(mini);
}
