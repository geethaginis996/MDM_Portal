sap.ui.define([
    "sap/ui/core/Fragment",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/Sorter",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (Fragment, JSONModel, Filter, FilterOperator, Sorter, MessageToast, MessageBox) {
    "use strict";

    /**
     * Reusable "Assign Fields" helper.
     *
     * Each detail controller mixes these methods in and calls
     * this._openAssignFields(oConfig) where oConfig is:
     *   {
     *     collection   : "/BPRoleFields",          // target junction collection
     *     fkName       : "role_role_id",           // FK column to the parent
     *     fkValue      : "FLVN01",                  // parent key value
     *     updateGroupId: "bpRoleUpdate",           // batch group used by the detail
     *     assignedIds  : ["NAME1","BUKRS"],        // field_ids already assigned
     *     extraProps   : function (sFieldId, sStatus, iSeq) { return {...}; }, // optional
     *     onDone       : function () { ... }        // reload callback
     *   }
     */
    return {

        _openAssignFields: function (oConfig) {
            this._assignCfg = oConfig;

            var oDlgModel = this.getView().getModel("dlg");
            if (!oDlgModel) {
                oDlgModel = new JSONModel({ availableFields: [], allFields: [], showStatus: true, title: "Assign Fields" });
                this.getView().setModel(oDlgModel, "dlg");
            }
            oDlgModel.setProperty("/showStatus", oConfig.includeStatus !== false);
            oDlgModel.setProperty("/title", oConfig.dialogTitle || "Assign Fields");

            var fnAfterLoad = function () {
                this._loadAvailableFields().then(function () {
                    this._oAssignDialog.open();
                }.bind(this));
            }.bind(this);

            if (this._oAssignDialog) {
                fnAfterLoad();
                return;
            }

            Fragment.load({
                id        : this.getView().getId(),
                name      : "mdm.portal.view.fragment.AssignFieldsDialog",
                controller: this
            }).then(function (oDialog) {
                this._oAssignDialog = oDialog;
                this.getView().addDependent(oDialog);
                fnAfterLoad();
            }.bind(this));
        },

        // Load all active fields, minus the already-assigned ones
        _loadAvailableFields: function () {
            var oModel = this.getOwnerComponent().getModel();
            var oDlgModel = this.getView().getModel("dlg");
            var oAssigned = {};
            (this._assignCfg.assignedIds || []).forEach(function (id) { oAssigned[id] = true; });

            return oModel.bindList("/FieldMasters", null, [new Sorter("field_id")], [
                new Filter("active", FilterOperator.EQ, true)
            ], {
                $select: "field_id,description,data_type,main_group_group_id,sub_group_group_id"
            }).requestContexts(0, Infinity).then(function (aCtx) {
                var aAll = aCtx
                    .filter(function (c) { return !oAssigned[c.getProperty("field_id")]; })
                    .map(function (c) {
                        var sMain = c.getProperty("main_group_group_id") || "";
                        var sSub  = c.getProperty("sub_group_group_id") || "";
                        return {
                            field_id   : c.getProperty("field_id"),
                            description: c.getProperty("description") || "",
                            data_type  : c.getProperty("data_type") || "",
                            group_path : (sMain + (sSub && sSub !== sMain ? " \u25b8 " + sSub : "")) || "\u2014"
                        };
                    });
                oDlgModel.setProperty("/allFields", aAll);
                oDlgModel.setProperty("/availableFields", aAll);
            }).catch(function (e) {
                MessageBox.error("Could not load fields: " + e.message);
            });
        },

        onDialogSearch: function (oEvent) {
            var sQuery = (oEvent.getParameter("newValue") || "").toLowerCase();
            var oDlgModel = this.getView().getModel("dlg");
            var aAll = oDlgModel.getProperty("/allFields") || [];
            if (!sQuery) {
                oDlgModel.setProperty("/availableFields", aAll);
                return;
            }
            var aFiltered = aAll.filter(function (o) {
                return o.field_id.toLowerCase().indexOf(sQuery) !== -1 ||
                       o.description.toLowerCase().indexOf(sQuery) !== -1;
            });
            oDlgModel.setProperty("/availableFields", aFiltered);
        },

        onAssignFieldsConfirm: function () {
            var oTable = Fragment.byId(this.getView().getId(), "dlgFieldsTable");
            var aSelected = oTable.getSelectedItems();
            if (!aSelected.length) {
                MessageToast.show("Select at least one field.");
                return;
            }

            var oCfg    = this._assignCfg;
            var bStatus = oCfg.includeStatus !== false; // default true
            var sStatus = bStatus
                ? Fragment.byId(this.getView().getId(), "dlgDefaultStatus").getSelectedKey()
                : null;
            var oModel  = this.getOwnerComponent().getModel();
            var oListBinding = oModel.bindList(oCfg.collection, null, [], [], {
                $$updateGroupId: oCfg.updateGroupId
            });

            // Determine a starting sequence (max existing + 10), stepping by 10
            var iSeq = ((oCfg.maxSequence || 0) + 10);

            aSelected.forEach(function (oItem) {
                var oCtxData = oItem.getBindingContext("dlg").getObject();
                var sFieldId = oCtxData.field_id;

                var oRow = {};
                oRow[oCfg.fkName]      = oCfg.fkValue;
                oRow.field_field_id    = sFieldId;
                oRow.sequence          = iSeq;
                if (bStatus) { oRow.field_status = sStatus; }
                if (oCfg.collection === "/BPCategoryFields") {
                    oRow.multiple_values = false;   // default; user can toggle via row press
                }
                if (typeof oCfg.extraProps === "function") {
                    var oExtra = oCfg.extraProps(sFieldId, sStatus, iSeq) || {};
                    Object.keys(oExtra).forEach(function (k) { oRow[k] = oExtra[k]; });
                }
                oListBinding.create(oRow);
                iSeq += 10;
            });

            oModel.submitBatch(oCfg.updateGroupId)
                .then(function () {
                    MessageToast.show(aSelected.length + " field(s) added.");
                    this._oAssignDialog.close();
                    if (typeof oCfg.onDone === "function") { oCfg.onDone(); }
                }.bind(this))
                .catch(function (e) {
                    MessageBox.error("Could not add fields: " + (e.message || "Unknown error"));
                });
        },

        onAssignFieldsCancel: function () {
            if (this._oAssignDialog) { this._oAssignDialog.close(); }
        }
    };
});