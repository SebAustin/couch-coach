import { afterView } from './after';
import { bootView, configErrorView, deniedView, endedView, invalidView, pairedView, primeView } from './basic';
import { pickerView } from './picker';
import { setView } from './set';
import type { Screen, ViewFactory } from './types';

export const VIEWS: Record<Screen, ViewFactory> = {
  boot: bootView,
  invalid: invalidView,
  config_error: configErrorView,
  prime: primeView,
  denied: deniedView,
  paired: pairedView,
  picker: pickerView,
  set: setView,
  after: afterView,
  ended: endedView,
};

export type { Actions, Screen, View, Vm } from './types';
