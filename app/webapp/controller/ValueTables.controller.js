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

    return Controller.extend("mdm.portal.controller.ValueTables", {

        // ── Lifecycle ────────────────────────────────────────────────
        onInit: function () {
            var oUiModel = new JSONModel({
                totalCount  : 0,
                usedByCounts: {}    // { valueTableId: fieldCount }
            });
            this.getView().setModel(oUiModel, "ui");

            // Pre-load how many fields use each value table
            this._loadUsedByCounts();

            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("valueTables").attachPatternMatched(this._onRouteMatched, this);
        },

        // ── Used-by counts (fields per value table) ──────────────────
        _loadUsedByCounts: function () {
            var oModel   = this.getOwnerComponent().getModel();
            var oUiModel = this.getView().getModel("ui");
            oModel.bindList("/FieldMasters", null, null, null, {
                $select: "field_id,value_table_value_table_id"
            }).requestContexts(0, Infinity).then(function (aCtx) {
                var oCounts = {};
                aCtx.forEach(function (c) {
                    var sVt = c.getProperty("value_table_value_table_id");
                    if (sVt) { oCounts[sVt] = (oCounts[sVt] || 0) + 1; }
                });
                oUiModel.setProperty("/usedByCounts", oCounts);
            }).catch(function () {
                // decorative — ignore errors
            });
        },

        _onRouteMatched: function () {
            var oTable = this.byId("valueTable");
            if (!oTable) { return; }
            var oBinding = oTable.getBinding("items");
            if (oBinding) {
                oBinding.attachEventOnce("dataReceived", this._onDataReceived, this);
                // Re-read so edits made on the detail page show on return
                oBinding.refresh();
            } else {
                this.getView().attachEventOnce("afterRendering", function () {
                    var oB = this.byId("valueTable").getBinding("items");
                    if (oB) {
                        oB.attachEventOnce("dataReceived", this._onDataReceived, this);
                    }
                }, this);
            }
        },

        // ── Data received — counts ───────────────────────────────────
        _onDataReceived: function () {
            var oBinding = this.byId("valueTable").getBinding("items");
            if (!oBinding) { return; }

            var oHeaderCtx = oBinding.getHeaderContext && oBinding.getHeaderContext();
            if (oHeaderCtx) {
                oHeaderCtx.requestProperty("$count").then(function (iTotal) {
                    this.byId("tableTitle").setText("Value Tables (" + (iTotal || 0) + ")");
                    this.getView().getModel("ui").setProperty("/totalCount", iTotal || 0);
                }.bind(this));
            }
            // Refresh used-by counts (a field's value-table link may have changed)
            this._loadUsedByCounts();
        },

        // ── Formatter: "Used By" count text ──────────────────────────
        formatUsedBy: function (sVtId, oCounts) {
            if (!sVtId || !oCounts) { return "\u2014"; }
            var iCount = oCounts[sVtId];
            if (iCount === undefined || iCount === null) { return "\u2014"; }
            return iCount + " field" + (iCount === 1 ? "" : "s");
        },

        // ── Filters ──────────────────────────────────────────────────
        onFilterLiveChange: function () { this._applyFilters(); },
        onFilterChange    : function () { this._applyFilters(); },
        onGo              : function () { this._applyFilters(); },

        _applyFilters: function () {
            var sSearch = this.byId("filterSearch").getValue();
            var sSource = this.byId("filterSourceTable").getValue();
            var sStatus = this.byId("filterStatus").getSelectedKey();

            var aFilters = [];

            if (sSearch) {
                aFilters.push(new Filter({
                    filters: [
                        new Filter("value_table_id", FilterOperator.Contains, sSearch),
                        new Filter("description",    FilterOperator.Contains, sSearch)
                    ],
                    and: false
                }));
            }
            if (sSource) {
                aFilters.push(new Filter("source_table", FilterOperator.Contains, sSource));
            }
            if (sStatus) {
                aFilters.push(new Filter("status", FilterOperator.EQ, sStatus));
            }

            var oBinding = this.byId("valueTable").getBinding("items");
            if (!oBinding) { return; }
            oBinding.filter(
                aFilters.length ? [new Filter({ filters: aFilters, and: true })] : []
            );
            oBinding.attachEventOnce("dataReceived", this._onDataReceived, this);
        },

        onClearFilters: function () {
            this.byId("filterSearch").setValue("");
            this.byId("filterSourceTable").setValue("");
            this.byId("filterStatus").setSelectedKey("");
            var oBinding = this.byId("valueTable").getBinding("items");
            if (oBinding) {
                oBinding.filter([]);
                oBinding.attachEventOnce("dataReceived", this._onDataReceived, this);
            }
        },

        // ── Multi-select toolbar ─────────────────────────────────────
        onSelectionChange: function () {
            var bHas = this.byId("valueTable").getSelectedItems().length > 0;
            this.byId("bulkActivateBtn").setVisible(bHas);
            this.byId("bulkDeleteBtn").setVisible(bHas);
            this.byId("bulkSeparator").setVisible(bHas);
        },

        onBulkActivate: function () {
            var aSelected = this.byId("valueTable").getSelectedItems();
            if (!aSelected.length) { return; }
            MessageBox.confirm("Activate " + aSelected.length + " value table(s)?", {
                title  : "Confirm Activation",
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.OK) {
                        var aPromises = aSelected.map(function (oItem) {
                            return oItem.getBindingContext().setProperty("status", "ACTIVE");
                        });
                        Promise.all(aPromises)
                            .then(function () {
                                return this.getOwnerComponent().getModel().submitBatch("$auto");
                            }.bind(this))
                            .then(function () { MessageToast.show("Activated successfully."); })
                            .catch(function (e) { MessageBox.error("Activation failed: " + e.message); });
                    }
                }.bind(this)
            });
        },

        onBulkDelete: function () {
            var aSelected = this.byId("valueTable").getSelectedItems();
            if (!aSelected.length) { return; }
            MessageBox.confirm("Delete " + aSelected.length + " value table(s)? This cannot be undone.", {
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
            var oCtx    = oButton.getBindingContext();

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
            this._oMenuCtx = oCtx;
            this._oActionSheet.openBy(oButton);
        },

        _onMenuEdit: function () {
            var sId = this._oMenuCtx.getProperty("value_table_id");
            this.getOwnerComponent().getRouter().navTo("valueTableDetail", {
                valueTableId: encodeURIComponent(sId)
            });
        },

        _onMenuDeactivate: function () {
            this._oMenuCtx.setProperty("status", "INACTIVE");
            this.getOwnerComponent().getModel().submitBatch("$auto")
                .then(function () { MessageToast.show("Value table deactivated."); })
                .catch(function (e) { MessageBox.error("Failed: " + e.message); });
        },

        // ── Navigation ───────────────────────────────────────────────
        onLinkPress: function (oEvent) {
            var sId = oEvent.getSource().getBindingContext().getProperty("value_table_id");
            this.getOwnerComponent().getRouter().navTo("valueTableDetail", {
                valueTableId: encodeURIComponent(sId)
            });
        },

        onRowPress: function (oEvent) {
            var sId = oEvent.getSource().getBindingContext().getProperty("value_table_id");
            this.getOwnerComponent().getRouter().navTo("valueTableDetail", {
                valueTableId: encodeURIComponent(sId)
            });
        },

        onAdd: function () {
            this.getOwnerComponent().getRouter().navTo("valueTableDetail", { valueTableId: "NEW" });
        },

        // ── Export ───────────────────────────────────────────────────
        onExport: function () {
            var oBinding = this.byId("valueTable").getBinding("items");
            if (!oBinding) { return; }
            oBinding.requestContexts(0, oBinding.getLength()).then(function (aCtx) {
                var aData = aCtx.map(function (oCtx) {
                    return {
                        "Table ID"    : oCtx.getProperty("value_table_id"),
                        "Description" : oCtx.getProperty("description"),
                        "Source Table": oCtx.getProperty("source_table"),
                        "Output Key"  : oCtx.getProperty("output_key"),
                        "Output Desc" : oCtx.getProperty("output_desc") || "",
                        "Input 1"     : oCtx.getProperty("input_1") || "",
                        "Input 2"     : oCtx.getProperty("input_2") || "",
                        "Input 3"     : oCtx.getProperty("input_3") || "",
                        "Status"      : oCtx.getProperty("status")
                    };
                });
                this._downloadCSV(aData, "value-tables.csv");
            }.bind(this)).catch(function (e) {
                MessageBox.error("Export failed: " + e.message);
            });
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