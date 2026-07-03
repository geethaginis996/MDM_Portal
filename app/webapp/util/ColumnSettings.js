sap.ui.define([
    "sap/m/Dialog",
    "sap/m/List",
    "sap/m/StandardListItem",
    "sap/m/Text",
    "sap/m/Button",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast"
], function (Dialog, List, StandardListItem, Text, Button, JSONModel, MessageToast) {
    "use strict";

    /**
     * Adds a dynamic "show/hide columns" settings dialog to a sap.m.Table,
     * wired to a gear/settings button. Shared by Field Master, Validation
     * Rules, and Field Groups so the behaviour (and its storage/UX quirks)
     * lives in one place instead of being copy-pasted per controller.
     *
     * Usage, from a controller:
     *   this._oColumnSettings = ColumnSettings(this, {
     *       storageKey: "mdmportal.<screen>.columnVisibility",
     *       columns: [
     *           { id: "colDescription", label: "Description" },
     *           ...
     *       ]
     *   });
     *   this._oColumnSettings.init();     // call once, e.g. from onInit,
     *                                     // to restore any saved visibility
     *   // wire the gear button's press handler to: this._oColumnSettings.open
     *
     * @param {sap.ui.core.mvc.Controller} oController - the owning controller
     *        (used for byId() and to attach the dialog as a dependent)
     * @param {object} oConfig
     * @param {string} oConfig.storageKey - unique localStorage key for this table
     * @param {Array<{id:string, label:string}>} oConfig.columns - toggleable
     *        columns, referenced by their view-local id. Any column not
     *        listed here (e.g. a structural key or actions column) is left
     *        alone and always stays visible.
     * @returns {{ init: Function, open: Function }}
     */
    return function (oController, oConfig) {
        var _oDialog = null;
        var _oModel  = null;

        function _byId(sId) { return oController.byId(sId); }

        function _restore() {
            try {
                var sSaved = window.localStorage.getItem(oConfig.storageKey);
                if (!sSaved) { return; }
                var oState = JSON.parse(sSaved);
                Object.keys(oState).forEach(function (sColId) {
                    var oColumn = _byId(sColId);
                    if (oColumn) { oColumn.setVisible(!!oState[sColId]); }
                });
            } catch (e) { /* corrupt/unavailable storage — ignore, defaults stand */ }
        }

        function _save() {
            try {
                var oState = {};
                oConfig.columns.forEach(function (oDef) {
                    var oColumn = _byId(oDef.id);
                    oState[oDef.id] = oColumn ? oColumn.getVisible() : true;
                });
                window.localStorage.setItem(oConfig.storageKey, JSON.stringify(oState));
            } catch (e) { /* localStorage unavailable — setting just won't persist */ }
        }

        // Rebuilds the dialog's model from each column's current `visible`
        // state, so the checkboxes always reflect reality when reopened.
        function _syncModel() {
            var aItems = oConfig.columns.map(function (oDef) {
                var oColumn = _byId(oDef.id);
                return {
                    id     : oDef.id,
                    label  : oDef.label,
                    visible: oColumn ? oColumn.getVisible() : true
                };
            });
            _oModel.setProperty("/items", aItems);
        }

        // Applies a checkbox toggle straight to the table column so the
        // table updates live, rather than waiting for a separate Apply step.
        function _onToggle(oEvent) {
            var aChanged = oEvent.getParameter("listItems") ||
                [oEvent.getParameter("listItem")].filter(Boolean);

            aChanged.forEach(function (oItem) {
                var oCtx = oItem.getBindingContext("colSettings");
                if (!oCtx) { return; }
                var sColId    = oCtx.getProperty("id");
                var bSelected = oItem.getSelected();

                oCtx.getModel().setProperty(oCtx.getPath() + "/visible", bSelected);

                var oColumn = _byId(sColId);
                if (oColumn) { oColumn.setVisible(bSelected); }
            });

            _save();
        }

        function _onReset() {
            oConfig.columns.forEach(function (oDef) {
                var oColumn = _byId(oDef.id);
                if (oColumn) { oColumn.setVisible(true); }
            });
            _syncModel();
            _save();
            MessageToast.show("Columns reset to default.");
        }

        function _build() {
            _oModel = new JSONModel({ items: [] });

            var oList = new List({
                mode: "MultiSelect",
                includeItemInSelection: true,
                items: {
                    path: "colSettings>/items",
                    template: new StandardListItem({
                        title   : "{colSettings>label}",
                        selected: "{colSettings>visible}"
                    })
                }
            });
            oList.setModel(_oModel, "colSettings");
            oList.attachSelectionChange(_onToggle);

            var oDialog = new Dialog({
                title: "Column Settings",
                contentWidth: "22rem",
                content: [
                    new Text({
                        text: "Choose which columns to show in the table."
                    }).addStyleClass("sapUiSmallMargin"),
                    oList
                ],
                beginButton: new Button({
                    text : "Reset to Default",
                    type : "Transparent",
                    press: _onReset
                }),
                endButton: new Button({
                    text : "Close",
                    type : "Emphasized",
                    press: function () { oDialog.close(); }
                })
            });

            oController.getView().addDependent(oDialog);
            return oDialog;
        }

        return {
            // Call once (e.g. from onInit) to restore any previously saved
            // column visibility for this table.
            init: _restore,
            // Wire directly to the gear button's press handler.
            open: function () {
                if (!_oDialog) { _oDialog = _build(); }
                _syncModel();
                _oDialog.open();
            }
        };
    };
});