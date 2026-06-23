sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/Sorter",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/m/ActionSheet",
    "sap/m/Button"
], function (
    Controller, Filter, FilterOperator, Sorter,
    JSONModel, MessageToast, MessageBox, ActionSheet, Button
) {
    "use strict";

    return Controller.extend("mdm.portal.controller.BPRoles", {

        onInit: function () {
            var oUiModel = new JSONModel({
                totalCount  : 0,
                fieldCounts : {},
                prereqCounts: {}
            });
            this.getView().setModel(oUiModel, "ui");

            var oFiltersModel = new JSONModel({ masterDataTypes: [{ key: "", text: "All types" }] });
            this.getView().setModel(oFiltersModel, "filters");
            this._loadMasterDataTypes(oFiltersModel);
            this._loadCounts();

            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("bpRoles").attachPatternMatched(this._onRouteMatched, this);
        },

        _loadMasterDataTypes: function (oFiltersModel) {
            // BP role "Master Data Type" is the Customer/Vendor/Both scope.
            oFiltersModel.setProperty("/masterDataTypes", [
                { key: "",         text: "All types" },
                { key: "CUSTOMER", text: "Customer" },
                { key: "VENDOR",   text: "Vendor" },
                { key: "BOTH",     text: "Both" }
            ]);
        },

        formatScope: function (sKey) {
            return ({ CUSTOMER: "Customer", VENDOR: "Vendor", BOTH: "Both" })[sKey] || "";
        },

        _loadCounts: function () {
            var oModel   = this.getOwnerComponent().getModel();
            var oUiModel = this.getView().getModel("ui");

            oModel.bindList("/BPRoleFields", null, null, null, {
                $select: "role_role_id,field_field_id"
            }).requestContexts(0, Infinity).then(function (aCtx) {
                var oCounts = {};
                aCtx.forEach(function (c) {
                    var sRole = c.getProperty("role_role_id");
                    if (sRole) { oCounts[sRole] = (oCounts[sRole] || 0) + 1; }
                });
                oUiModel.setProperty("/fieldCounts", oCounts);
            }).catch(function () {});

            oModel.bindList("/BPRolePrereqFields", null, null, null, {
                $select: "role_role_id,field_field_id"
            }).requestContexts(0, Infinity).then(function (aCtx) {
                var oCounts = {};
                aCtx.forEach(function (c) {
                    var sRole = c.getProperty("role_role_id");
                    if (sRole) { oCounts[sRole] = (oCounts[sRole] || 0) + 1; }
                });
                oUiModel.setProperty("/prereqCounts", oCounts);
            }).catch(function () {});
        },

        _onRouteMatched: function () {
            var oTable = this.byId("roleTable");
            if (!oTable) { return; }
            var oBinding = oTable.getBinding("items");
            if (oBinding) {
                oBinding.attachEventOnce("dataReceived", this._onDataReceived, this);
                oBinding.refresh();
            } else {
                this.getView().attachEventOnce("afterRendering", function () {
                    var oB = this.byId("roleTable").getBinding("items");
                    if (oB) { oB.attachEventOnce("dataReceived", this._onDataReceived, this); }
                }, this);
            }
        },

        _onDataReceived: function () {
            var oBinding = this.byId("roleTable").getBinding("items");
            if (!oBinding) { return; }
            var oHeaderCtx = oBinding.getHeaderContext && oBinding.getHeaderContext();
            if (oHeaderCtx) {
                oHeaderCtx.requestProperty("$count").then(function (iTotal) {
                    this.byId("tableTitle").setText("BP Roles (" + (iTotal || 0) + ")");
                    this.getView().getModel("ui").setProperty("/totalCount", iTotal || 0);
                }.bind(this));
            }
            this._loadCounts();
        },

        formatYesNo: function (vVal) {
            return this._truthy(vVal) ? "Yes" : "No";
        },

        // ValueState for a Yes/No flag (for ObjectStatus.state, which must be a
        // ValueState — never the "Yes"/"No" text itself).
        formatYesNoState: function (vVal) {
            return this._truthy(vVal) ? "Information" : "None";
        },
        formatActiveText: function (vActive) {
            return this._truthy(vActive) ? "Active" : "Inactive";
        },
        formatActiveState: function (vActive) {
            return this._truthy(vActive) ? "Success" : "Error";
        },
        _truthy: function (v) {
            if (typeof v === "string") {
                var s = v.trim().toLowerCase();
                return (s === "yes" || s === "true" || s === "1" || s === "active" || s === "x");
            }
            return v === true || v === 1;
        },
        formatCount: function (sRoleId, oCounts) {
            if (!sRoleId || !oCounts) { return "0"; }
            var iCount = oCounts[sRoleId];
            return (iCount === undefined || iCount === null) ? "0" : String(iCount);
        },

        onFilterLiveChange: function () { this._applyFilters(); },
        onFilterChange    : function () { this._applyFilters(); },
        onGo              : function () { this._applyFilters(); },

        _applyFilters: function () {
            var sSearch = this.byId("filterSearch").getValue();
            var sMDT    = this.byId("filterMDT").getSelectedKey();
            var sStatus = this.byId("filterStatus").getSelectedKey();

            var aFilters = [];
            if (sSearch) {
                aFilters.push(new Filter({
                    filters: [
                        new Filter({ path: "role_id", operator: FilterOperator.Contains, value1: sSearch, caseSensitive: false }),
                        new Filter({ path: "description", operator: FilterOperator.Contains, value1: sSearch, caseSensitive: false })
                    ],
                    and: false
                }));
            }
            if (sMDT) {
                aFilters.push(new Filter("account_scope", FilterOperator.EQ, sMDT));
            }
            if (sStatus !== "") {
                aFilters.push(new Filter("active", FilterOperator.EQ, sStatus === "true"));
            }

            var oBinding = this.byId("roleTable").getBinding("items");
            if (!oBinding) { return; }
            oBinding.filter(aFilters.length ? [new Filter({ filters: aFilters, and: true })] : []);
            oBinding.attachEventOnce("dataReceived", this._onDataReceived, this);
        },

        onClearFilters: function () {
            this.byId("filterSearch").setValue("");
            this.byId("filterMDT").setSelectedKey("");
            this.byId("filterStatus").setSelectedKey("");
            var oBinding = this.byId("roleTable").getBinding("items");
            if (oBinding) {
                oBinding.filter([]);
                oBinding.attachEventOnce("dataReceived", this._onDataReceived, this);
            }
        },

        onSelectionChange: function () {
            var bHas = this.byId("roleTable").getSelectedItems().length > 0;
            this.byId("bulkActivateBtn").setVisible(bHas);
            this.byId("bulkDeleteBtn").setVisible(bHas);
            this.byId("bulkSeparator").setVisible(bHas);
        },

        onBulkActivate: function () {
            var aSelected = this.byId("roleTable").getSelectedItems();
            if (!aSelected.length) { return; }
            MessageBox.confirm("Activate " + aSelected.length + " role(s)?", {
                title  : "Confirm Activation",
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.OK) {
                        var aPromises = aSelected.map(function (oItem) {
                            return oItem.getBindingContext().setProperty("active", true);
                        });
                        Promise.all(aPromises)
                            .then(function () { return this.getOwnerComponent().getModel().submitBatch("$auto"); }.bind(this))
                            .then(function () { MessageToast.show("Activated successfully."); })
                            .catch(function (e) { MessageBox.error("Activation failed: " + e.message); });
                    }
                }.bind(this)
            });
        },

        onBulkDelete: function () {
            var aSelected = this.byId("roleTable").getSelectedItems();
            if (!aSelected.length) { return; }
            MessageBox.confirm("Delete " + aSelected.length + " role(s)? This cannot be undone.", {
                title  : "Confirm Deletion",
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.OK) {
                        var aPromises = aSelected.map(function (oItem) {
                            return oItem.getBindingContext().delete("$auto");
                        });
                        Promise.all(aPromises)
                            .then(function () { MessageToast.show("Deleted successfully."); })
                            .catch(function (e) { MessageBox.error("Delete failed: " + e.message); });
                    }
                }.bind(this)
            });
        },

        onRowMenuPress: function (oEvent) {
            var oButton = oEvent.getSource();
            this._oMenuCtx = oButton.getBindingContext();
            if (!this._oActionSheet) {
                this._oActionSheet = new ActionSheet({
                    buttons: [
                        new Button({ text: "Edit",       icon: "sap-icon://edit",    press: this._onMenuEdit.bind(this) }),
                        new Button({ text: "Duplicate",  icon: "sap-icon://copy",    press: function () { MessageToast.show("Duplicate — coming soon"); } }),
                        new Button({ text: "Deactivate", icon: "sap-icon://decline", press: this._onMenuDeactivate.bind(this) })
                    ]
                });
                this.getView().addDependent(this._oActionSheet);
            }
            this._oActionSheet.openBy(oButton);
        },

        _onMenuEdit: function () {
            var sId = this._oMenuCtx.getProperty("role_id");
            this.getOwnerComponent().getRouter().navTo("bpRoleDetail", { roleId: encodeURIComponent(sId.toLowerCase()) });
        },

        _onMenuDeactivate: function () {
            this._oMenuCtx.setProperty("active", false);
            this.getOwnerComponent().getModel().submitBatch("$auto")
                .then(function () { MessageToast.show("Role deactivated."); })
                .catch(function (e) { MessageBox.error("Failed: " + e.message); });
        },

        onLinkPress: function (oEvent) {
            var sId = oEvent.getSource().getBindingContext().getProperty("role_id");
            this.getOwnerComponent().getRouter().navTo("bpRoleDetail", { roleId: encodeURIComponent(sId.toLowerCase()) });
        },

        onRowPress: function (oEvent) {
            var sId = oEvent.getSource().getBindingContext().getProperty("role_id");
            this.getOwnerComponent().getRouter().navTo("bpRoleDetail", { roleId: encodeURIComponent(sId.toLowerCase()) });
        },

        onAdd: function () {
            this.getOwnerComponent().getRouter().navTo("bpRoleDetail", { roleId: "NEW" });
        },

        onExport: function () {
            var oBinding = this.byId("roleTable").getBinding("items");
            if (!oBinding) { return; }
            oBinding.requestContexts(0, oBinding.getLength()).then(function (aCtx) {
                var aData = aCtx.map(function (oCtx) {
                    return {
                        "Role Name"          : oCtx.getProperty("role_id"),
                        "Description"        : oCtx.getProperty("description"),
                        "Master Data Type"   : this.formatScope(oCtx.getProperty("account_scope")),
                        "Initial BP Required": oCtx.getProperty("initial_bp_required") ? "Yes" : "No",
                        "Sequence"           : oCtx.getProperty("sequence"),
                        "Active"             : oCtx.getProperty("active") ? "Yes" : "No"
                    };
                }.bind(this));
                this._downloadCSV(aData, "bp-roles.csv");
            }.bind(this)).catch(function (e) { MessageBox.error("Export failed: " + e.message); });
        },

        _downloadCSV: function (aData, sFilename) {
            if (!aData || !aData.length) { MessageToast.show("No data to export."); return; }
            var aKeys = Object.keys(aData[0]);
            var sCSV  = aKeys.join(",") + "\n" +
                aData.map(function (r) {
                    return aKeys.map(function (k) {
                        return '"' + String(r[k] !== undefined ? r[k] : "").replace(/"/g, '""') + '"';
                    }).join(",");
                }).join("\n");
            var oBlob = new Blob([sCSV], { type: "text/csv;charset=utf-8;" });
            var sUrl  = URL.createObjectURL(oBlob);
            var oLink = document.createElement("a");
            oLink.href = sUrl; oLink.download = sFilename; oLink.click();
            URL.revokeObjectURL(sUrl);
        }
    });
});