/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { TPromise } from 'vs/base/common/winjs.base';
import nls = require('vs/nls');
import { Registry } from 'vs/platform/registry/common/platform';
import { Action } from 'vs/base/common/actions';
import { SyncActionDescriptor } from 'vs/platform/actions/common/actions';
import { IWorkbenchActionRegistry, Extensions } from 'vs/workbench/common/actions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';

export class ToggleTabsVisibilityAction extends Action {

	public static readonly ID = 'workbench.action.toggleTabsVisibility';
	public static readonly LABEL = nls.localize('toggleTabs', "Toggle Tab Visibility");

	private static readonly tabsVisibleKey = 'workbench.editor.showTabs';

	constructor(
		id: string,
		label: string,
		@IConfigurationService private configurationService: IConfigurationService
	) {
		super(id, label);
	}

	public run(): TPromise<any> {
		const visibility = this.configurationService.getValue<string>(ToggleTabsVisibilityAction.tabsVisibleKey);
		const newVisibilityValue = !visibility;

		return this.configurationService.updateValue(ToggleTabsVisibilityAction.tabsVisibleKey, newVisibilityValue);
	}
}

const registry = Registry.as<IWorkbenchActionRegistry>(Extensions.WorkbenchActions);
registry.registerWorkbenchAction(new SyncActionDescriptor(ToggleTabsVisibilityAction, ToggleTabsVisibilityAction.ID, ToggleTabsVisibilityAction.LABEL, { primary: KeyMod.CtrlCmd | KeyMod.WinCtrl | KeyCode.KEY_W }), 'View: Toggle Tab Visibility', nls.localize('view', "View"));