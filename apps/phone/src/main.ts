import '@fontsource/bricolage-grotesque/latin-700.css';
import '@fontsource/bricolage-grotesque/latin-800.css';
import '@fontsource/figtree/latin-500.css';
import '@fontsource/figtree/latin-700.css';
import './styles/tokens.css';
import './styles/app.css';
import { cameraAlreadyGranted } from './camera';
import { loadClientConfig } from './config';
import { createController } from './controller';
import { parseSessionParams } from './logic/session-params';

function el(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing #${id}`);
  return found;
}

async function boot(): Promise<void> {
  const controller = createController({ ui: el('ui'), stage: el('stage'), chip: el('chip'), notice: el('notice'), debug: el('debug') });
  controller.show('boot');
  const params = parseSessionParams(location.search);
  if (!params.ok) {
    controller.show('invalid');
    return;
  }
  try {
    const config = await loadClientConfig();
    await controller.start(
      { sessionId: params.sessionId, token: params.token, memberId: params.memberId },
      config,
      await cameraAlreadyGranted(),
    );
  } catch (err) {
    console.error(err);
    controller.show('config_error');
  }
}

void boot();
