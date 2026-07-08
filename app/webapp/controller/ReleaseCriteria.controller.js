sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (
    Controller, Filter, FilterOperator,
    MessageToast, MessageBox
) {
    "use strict";

    return Controller.extend("mdm.portal.controller.ReleaseCriteria", {

        // ── Lifecycle ────────────────────────────────────────────────
        onInit: function () {
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("releaseCriteria").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function () {
            var oTable = this.byId("criteriaTable");
            if (!oTable) { return; }
            var oBinding = oTable.getBinding("items");
            if (oBinding) {
                oBinding.attachEventOnce("dataReceived", this._onDataReceived, this);
                oBinding.refresh();
            } else {
                this.getView().attachEventOnce("afterRendering", function () {
                    var oB = this.byId("criteriaTable").getBinding("items");
                    if (oB) { oB.attachEventOnce("dataReceived", this._onDataReceived, this); }
                }, this);
            }
        },

        _onDataReceived: function () {
            var oBinding = this.byId("criteriaTable").getBinding("items");
            if (!oBinding) { return; }
            var oHeaderCtx = oBinding.getHeaderContext && oBinding.getHeaderContext();
            if (oHeaderCtx) {
                oHeaderCtx.requestProperty("$count").then(function (iTotal) {
                    var oTitle = this.byId("tableTitle");
                    if (oTitle) { oTitle.setText("Release Criteria (" + (iTotal || 0) + ")"); }
                }.bind(this));
            }
        },

        // ── Filters ──────────────────────────────────────────────────
        onFilterLiveChange: function () { this._applyFilters(); },
        onFilterChange    : function () { this._applyFilters(); },
        onGo              : function () { this._applyFilters(); },

        _applyFilters: function () {
            var sSearch     = this.byId("filterSearch").getValue();
            var sAppliesTo  = this.byId("filterAppliesTo").getSelectedKey();
            var sStatus     = this.byId("filterStatus").getSelectedKey();

            var aFilters = [];

            if (sSearch) {
                aFilters.push(new Filter({
                    filters: [
                        new Filter({ path: "characteristic_id", operator: FilterOperator.Contains, value1: sSearch, caseSensitive: false }),
                        new Filter({ path: "description",       operator: FilterOperator.Contains, value1: sSearch, caseSensitive: false })
                    ],
                    and: false
                }));
            }
            if (sAppliesTo) {
                aFilters.push(new Filter("master_data_type_master_data_type_id", FilterOperator.EQ, sAppliesTo));
            }
            if (sStatus) {
                aFilters.push(new Filter("active", FilterOperator.EQ, sStatus === "true"));
            }

            var oBinding = this.byId("criteriaTable").getBinding("items");
            if (!oBinding) { return; }

            oBinding.filter(
                aFilters.length ? [new Filter({ filters: aFilters, and: true })] : []
            );
            oBinding.attachEventOnce("dataReceived", this._onDataReceived, this);
        },

        onClearFilters: function () {
            this.byId("filterSearch").setValue("");
            this.byId("filterAppliesTo").setSelectedKey("");
            this.byId("filterStatus").setSelectedKey("");
            var oBinding = this.byId("criteriaTable").getBinding("items");
            if (oBinding) {
                oBinding.filter([]);
                oBinding.attachEventOnce("dataReceived", this._onDataReceived, this);
            }
        },

        // ── Multi-select toolbar ─────────────────────────────────────
        onSelectionChange: function () {
            var bHas = this.byId("criteriaTable").getSelectedItems().length > 0;
            this.byId("bulkDeleteBtn").setVisible(bHas);
            this.byId("bulkSeparator").setVisible(bHas);
        },

        onBulkDelete: function () {
            var aSelected = this.byId("criteriaTable").getSelectedItems();
            if (!aSelected.length) { return; }
            MessageBox.confirm("Delete " + aSelected.length + " release criteria? This cannot be undone.", {
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

        // ── Navigation ───────────────────────────────────────────────
        onLinkPress: function (oEvent) {
            var sId = oEvent.getSource().getBindingContext().getProperty("characteristic_id");
            this.getOwnerComponent().getRouter().navTo("releaseCriteriaDetail", {
                criteriaId: encodeURIComponent(sId.toLowerCase())
            });
        },

        onRowPress: function (oEvent) {
            var sId = oEvent.getSource().getBindingContext().getProperty("characteristic_id");
            this.getOwnerComponent().getRouter().navTo("releaseCriteriaDetail", {
                criteriaId: encodeURIComponent(sId.toLowerCase())
            });
        },

        onAdd: function () {
            this.getOwnerComponent().getRouter().navTo("releaseCriteriaDetail", { criteriaId: "NEW" });
        },

        // ── Export ───────────────────────────────────────────────────
        onExport: function () {
            var oBinding = this.byId("criteriaTable").getBinding("items");
            if (!oBinding) { return; }
            oBinding.requestContexts(0, oBinding.getLength()).then(function (aCtx) {
                var aData = aCtx.map(function (oCtx) {
                    return {
                        "Criteria ID" : oCtx.getProperty("characteristic_id"),
                        "Description" : oCtx.getProperty("description"),
                        "Applies To"  : oCtx.getProperty("master_data_type_master_data_type_id"),
                        "Source Field": oCtx.getProperty("field_field_id"),
                        "Data Type"   : oCtx.getProperty("data_type"),
                        "Active"      : oCtx.getProperty("active")
                    };
                });
                this._downloadCSV(aData, "release-criteria.csv");
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
