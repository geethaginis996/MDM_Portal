sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/m/ActionSheet",
    "sap/m/Button"
], function (
    Controller, Filter, FilterOperator,
    JSONModel, MessageToast, MessageBox, ActionSheet, Button
) {
    "use strict";

    return Controller.extend("mdm.portal.controller.AccountGroups", {

        onInit: function () {
            var oUiModel = new JSONModel({
                customerCount: 0,
                vendorCount  : 0,
                fieldCounts  : {},
                currentType  : "CUSTOMER"
            });
            this.getView().setModel(oUiModel, "ui");

            this._loadCounts();

            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("accountGroups").attachPatternMatched(this._onRouteMatched, this);
        },

        // Field counts per account group, plus customer/vendor totals
        _loadCounts: function () {
            var oModel   = this.getOwnerComponent().getModel();
            var oUiModel = this.getView().getModel("ui");

            oModel.bindList("/AccountGroupFields", null, null, null, {
                $select: "account_group_account_group_id,field_field_id"
            }).requestContexts(0, Infinity).then(function (aCtx) {
                var oCounts = {};
                aCtx.forEach(function (c) {
                    var sId = c.getProperty("account_group_account_group_id");
                    if (sId) { oCounts[sId] = (oCounts[sId] || 0) + 1; }
                });
                oUiModel.setProperty("/fieldCounts", oCounts);
            }).catch(function () {});

            oModel.bindList("/AccountGroups", null, null, null, {
                $select: "account_group_id,type"
            }).requestContexts(0, Infinity).then(function (aCtx) {
                var iCust = 0, iVen = 0;
                aCtx.forEach(function (c) {
                    if (c.getProperty("type") === "CUSTOMER") { iCust++; }
                    else if (c.getProperty("type") === "VENDOR") { iVen++; }
                });
                oUiModel.setProperty("/customerCount", iCust);
                oUiModel.setProperty("/vendorCount", iVen);
            }).catch(function () {});
        },

        _onRouteMatched: function () {
            var oTable = this.byId("agTable");
            if (!oTable) { return; }
            var oBinding = oTable.getBinding("items");
            if (oBinding) {
                this._applyFilters();
                oBinding.attachEventOnce("dataReceived", this._onDataReceived, this);
            } else {
                this.getView().attachEventOnce("afterRendering", function () {
                    this._applyFilters();
                }.bind(this));
            }
        },

        _onDataReceived: function () {
            var oBinding = this.byId("agTable").getBinding("items");
            if (!oBinding) { return; }
            var oHeaderCtx = oBinding.getHeaderContext && oBinding.getHeaderContext();
            if (oHeaderCtx) {
                oHeaderCtx.requestProperty("$count").then(function (iTotal) {
                    var sType = this.getView().getModel("ui").getProperty("/currentType");
                    var sLabel = (sType === "VENDOR" ? "Vendor" : "Customer");
                    this.byId("tableTitle").setText(sLabel + " Account Groups (" + (iTotal || 0) + ")");
                }.bind(this));
            }
            this._loadCounts();
        },

        // ── Segmented Customer/Vendor toggle ─────────────────────────
        onTypeSegmentChange: function (oEvent) {
            var sKey = oEvent.getParameter("item").getKey();
            this.getView().getModel("ui").setProperty("/currentType", sKey);
            this._applyFilters();
        },

        // ── Formatters ───────────────────────────────────────────────
        formatType: function (sType) {
            if (sType === "CUSTOMER") { return "Customer"; }
            if (sType === "VENDOR")   { return "Vendor"; }
            return sType || "—";
        },
        formatNumberRange: function (sMode) {
            if (sMode === "INTERNAL") { return "Internal (1–999999)"; }
            if (sMode === "EXTERNAL") { return "External (A–Z)"; }
            return sMode || "—";
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
        formatCount: function (sId, oCounts) {
            if (!sId || !oCounts) { return "0"; }
            var iCount = oCounts[sId];
            return (iCount === undefined || iCount === null) ? "0" : String(iCount);
        },

        // ── Filters ──────────────────────────────────────────────────
        onFilterLiveChange: function () { this._applyFilters(); },
        onFilterChange    : function () { this._applyFilters(); },
        onGo              : function () { this._applyFilters(); },

        _applyFilters: function () {
            var sSearch = this.byId("filterSearch").getValue();
            var sStatus = this.byId("filterStatus").getSelectedKey();
            var sType   = this.getView().getModel("ui").getProperty("/currentType");

            var aFilters = [new Filter("type", FilterOperator.EQ, sType)];
            if (sSearch) {
                aFilters.push(new Filter({
                    filters: [
                        new Filter("account_group_id", FilterOperator.Contains, sSearch),
                        new Filter("description",       FilterOperator.Contains, sSearch)
                    ],
                    and: false
                }));
            }
            if (sStatus !== "") {
                aFilters.push(new Filter("active", FilterOperator.EQ, sStatus === "true"));
            }

            var oBinding = this.byId("agTable").getBinding("items");
            if (!oBinding) { return; }
            oBinding.filter([new Filter({ filters: aFilters, and: true })]);
            oBinding.attachEventOnce("dataReceived", this._onDataReceived, this);
        },

        onClearFilters: function () {
            this.byId("filterSearch").setValue("");
            this.byId("filterStatus").setSelectedKey("");
            this._applyFilters();
        },

        // ── Multi-select ─────────────────────────────────────────────
        onSelectionChange: function () {
            var bHas = this.byId("agTable").getSelectedItems().length > 0;
            this.byId("bulkActivateBtn").setVisible(bHas);
            this.byId("bulkDeleteBtn").setVisible(bHas);
            this.byId("bulkSeparator").setVisible(bHas);
        },

        onBulkActivate: function () {
            var aSelected = this.byId("agTable").getSelectedItems();
            if (!aSelected.length) { return; }
            MessageBox.confirm("Activate " + aSelected.length + " account group(s)?", {
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
            var aSelected = this.byId("agTable").getSelectedItems();
            if (!aSelected.length) { return; }
            MessageBox.confirm("Delete " + aSelected.length + " account group(s)? This cannot be undone.", {
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

        // ── Row context menu ─────────────────────────────────────────
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
            var sId = this._oMenuCtx.getProperty("account_group_id");
            this.getOwnerComponent().getRouter().navTo("accountGroupDetail", { accountGroupId: encodeURIComponent(sId) });
        },

        _onMenuDeactivate: function () {
            this._oMenuCtx.setProperty("active", false);
            this.getOwnerComponent().getModel().submitBatch("$auto")
                .then(function () { MessageToast.show("Account group deactivated."); })
                .catch(function (e) { MessageBox.error("Failed: " + e.message); });
        },

        // ── Navigation ───────────────────────────────────────────────
        onLinkPress: function (oEvent) {
            var sId = oEvent.getSource().getBindingContext().getProperty("account_group_id");
            this.getOwnerComponent().getRouter().navTo("accountGroupDetail", { accountGroupId: encodeURIComponent(sId) });
        },
        onRowPress: function (oEvent) {
            var sId = oEvent.getSource().getBindingContext().getProperty("account_group_id");
            this.getOwnerComponent().getRouter().navTo("accountGroupDetail", { accountGroupId: encodeURIComponent(sId) });
        },
        onAdd: function () {
            this.getOwnerComponent().getRouter().navTo("accountGroupDetail", { accountGroupId: "NEW" });
        },

        // ── Export ───────────────────────────────────────────────────
        onExport: function () {
            var oBinding = this.byId("agTable").getBinding("items");
            if (!oBinding) { return; }
            oBinding.requestContexts(0, oBinding.getLength()).then(function (aCtx) {
                var aData = aCtx.map(function (oCtx) {
                    return {
                        "Account Group" : oCtx.getProperty("account_group_id"),
                        "Description"   : oCtx.getProperty("description"),
                        "Type"          : oCtx.getProperty("type"),
                        "Number Range"  : oCtx.getProperty("assignment_mode"),
                        "Active"        : oCtx.getProperty("active") ? "Yes" : "No"
                    };
                });
                this._downloadCSV(aData, "account-groups.csv");
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