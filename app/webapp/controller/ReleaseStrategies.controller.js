sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/Sorter",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (
    Controller, JSONModel, Filter, FilterOperator, Sorter,
    MessageToast, MessageBox
) {
    "use strict";

    return Controller.extend("mdm.portal.controller.ReleaseStrategies", {

        // ── Lifecycle ────────────────────────────────────────────────
        onInit: function () {
            this._oComboCache = {};
            this._oCodesCache = {};

            // "Applies To" filter options — built as a single local array
            // (starting with a synthetic "All" entry) rather than binding
            // the Select directly to the OData /MasterDataTypes collection,
            // since mixing a static <core:Item> with a bound aggregation on
            // the same control triggers "list bindings support only a
            // single template object".
            var oLookups = new JSONModel({ appliesTo: [{ key: "", text: "All" }] });
            this.getView().setModel(oLookups, "lookups");

            var oModel = this.getOwnerComponent().getModel();
            oModel.bindList("/MasterDataTypes", null, [new Sorter("sequence")])
                .requestContexts(0, Infinity).then(function (aCtx) {
                    var aItems = oLookups.getProperty("/appliesTo").concat(
                        aCtx.map(function (c) {
                            return {
                                key : c.getProperty("master_data_type_id"),
                                text: c.getProperty("description")
                            };
                        })
                    );
                    oLookups.setProperty("/appliesTo", aItems);
                }).catch(function () { /* filter just won't have extra options */ });

            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("releaseStrategies").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function () {
            this._oComboCache = {};
            this._oCodesCache = {};
            var oTable = this.byId("strategiesTable");
            if (!oTable) { return; }
            var oBinding = oTable.getBinding("items");
            if (oBinding) {
                // Persistent (not "once") — growing/infinite-scroll fires a
                // fresh dataReceived for each additional page, and each one
                // needs its own rows added to the cache.
                oBinding.detachEvent("dataReceived", this._onDataReceived, this);
                oBinding.attachEvent("dataReceived", this._onDataReceived, this);
                oBinding.refresh();
            } else {
                this.getView().attachEventOnce("afterRendering", function () {
                    var oB = this.byId("strategiesTable").getBinding("items");
                    if (oB) {
                        oB.detachEvent("dataReceived", this._onDataReceived, this);
                        oB.attachEvent("dataReceived", this._onDataReceived, this);
                    }
                }, this);
            }
        },

        _onDataReceived: function () {
            var oTable = this.byId("strategiesTable");
            if (!oTable) { return; }
            var oBinding = oTable.getBinding("items");
            if (!oBinding) { return; }

            var oHeaderCtx = oBinding.getHeaderContext && oBinding.getHeaderContext();
            if (oHeaderCtx) {
                oHeaderCtx.requestProperty("$count").then(function (iTotal) {
                    var oTitle = this.byId("tableTitle");
                    if (oTitle) { oTitle.setText("Release Strategies (" + (iTotal || 0) + ")"); }
                }.bind(this));
            }

            // Binding a formatter directly to an expanded collection path
            // (e.g. text="{path: 'values', formatter: ...}") doesn't
            // reliably work in the OData V4 model — it silently resolves to
            // nothing rather than passing the array through. Instead, read
            // the already-expanded raw data via getObject() (which DOES
            // include $expand'd nested arrays) and cache formatted strings
            // keyed by strategy_id; the cells bind to the plain scalar
            // strategy_id and look themselves up in that cache.
            oBinding.getCurrentContexts().forEach(function (oCtx) {
                if (!oCtx || !oCtx.getObject) { return; }
                var oData = oCtx.getObject();
                if (!oData || !oData.strategy_id) { return; }
                this._oComboCache[oData.strategy_id] = this._computeCriteriaCombination(oData.values);
                this._oCodesCache[oData.strategy_id] = this._computeReleaseCodesCount(oData.steps);
            }.bind(this));

            // The cells were already rendered with the (empty, at the time)
            // cache — force their formatters to re-run now that the cache
            // has real data, without triggering a new server request.
            oTable.getItems().forEach(function (oItem) {
                var aCells = oItem.getCells();
                if (aCells[3]) {
                    var oComboBinding = aCells[3].getBinding("text");
                    if (oComboBinding) { oComboBinding.checkUpdate(true); }
                }
                if (aCells[4]) {
                    var oCodesBinding = aCells[4].getBinding("text");
                    if (oCodesBinding) { oCodesBinding.checkUpdate(true); }
                }
            });
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
                        new Filter({ path: "strategy_id", operator: FilterOperator.Contains, value1: sSearch, caseSensitive: false }),
                        new Filter({ path: "description",  operator: FilterOperator.Contains, value1: sSearch, caseSensitive: false })
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

            var oBinding = this.byId("strategiesTable").getBinding("items");
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
            var oBinding = this.byId("strategiesTable").getBinding("items");
            if (oBinding) {
                oBinding.filter([]);
                oBinding.attachEventOnce("dataReceived", this._onDataReceived, this);
            }
        },

        // ── Multi-select toolbar ─────────────────────────────────────
        onSelectionChange: function () {
            var bHas = this.byId("strategiesTable").getSelectedItems().length > 0;
            this.byId("bulkDeleteBtn").setVisible(bHas);
            this.byId("bulkSeparator").setVisible(bHas);
        },

        onBulkDelete: function () {
            var aSelected = this.byId("strategiesTable").getSelectedItems();
            if (!aSelected.length) { return; }
            MessageBox.confirm("Delete " + aSelected.length + " release strategies? This cannot be undone.", {
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
            var oCtx = oEvent.getSource().getBindingContext();
            var sId  = oCtx.getProperty("strategy_id");
            var sMdt = oCtx.getProperty("master_data_type_master_data_type_id");
            this.getOwnerComponent().getRouter().navTo("releaseStrategyDetail", {
                strategyId: encodeURIComponent(sId.toLowerCase()),
                appliesTo : encodeURIComponent(sMdt)
            });
        },

        onRowPress: function (oEvent) {
            var oCtx = oEvent.getSource().getBindingContext();
            var sId  = oCtx.getProperty("strategy_id");
            var sMdt = oCtx.getProperty("master_data_type_master_data_type_id");
            this.getOwnerComponent().getRouter().navTo("releaseStrategyDetail", {
                strategyId: encodeURIComponent(sId.toLowerCase()),
                appliesTo : encodeURIComponent(sMdt)
            });
        },

        onAdd: function () {
            this.getOwnerComponent().getRouter().navTo("releaseStrategyDetail", {
                strategyId: "NEW",
                appliesTo : "NEW"
            });
        },

        // ── Export ───────────────────────────────────────────────────
        onExport: function () {
            var oBinding = this.byId("strategiesTable").getBinding("items");
            if (!oBinding) { return; }
            oBinding.requestContexts(0, oBinding.getLength()).then(function (aCtx) {
                var aData = aCtx.map(function (oCtx) {
                    return {
                        "Strategy ID"        : oCtx.getProperty("strategy_id"),
                        "Description"        : oCtx.getProperty("description"),
                        "Applies To"         : oCtx.getProperty("master_data_type_master_data_type_id"),
                        "Criteria Combination": this._computeCriteriaCombination(oCtx.getProperty("values")),
                        "Release Codes"      : this._computeReleaseCodesCount(oCtx.getProperty("steps")),
                        "Active"             : oCtx.getProperty("active")
                    };
                }.bind(this));
                this._downloadCSV(aData, "release-strategies.csv");
            }.bind(this)).catch(function (e) {
                MessageBox.error("Export failed: " + e.message);
            });
        },

        // ── Formatters for the expanded preview columns ─────────────
        // Cells bind to the plain scalar strategy_id (guaranteed to work)
        // and look themselves up in a cache populated in _onDataReceived
        // from the real expanded data — see the comment there for why.
        formatCriteriaCombination: function (sStrategyId) {
            return (this._oComboCache && this._oComboCache[sStrategyId]) || "\u2014";
        },

        formatReleaseCodesCount: function (sStrategyId) {
            return (this._oCodesCache && this._oCodesCache[sStrategyId]) || "No codes yet";
        },

        // "values" and "steps" arrive already-expanded as part of the main
        // list query (see the $expand in the view), so these just need to
        // summarize data that's already loaded — no extra per-row requests.
        _computeCriteriaCombination: function (aValues) {
            if (!aValues || !aValues.length) { return "\u2014"; }
            return aValues.map(function (o) {
                var sVal = o.operator === "BETWEEN"
                    ? o.value_from + "\u2013" + o.value_to
                    : o.value_from;
                return o.characteristic_characteristic_id + "=" + sVal;
            }).join(", ");
        },

        _computeReleaseCodesCount: function (aSteps) {
            var iCount = aSteps ? aSteps.length : 0;
            if (iCount === 0) { return "No codes yet"; }
            return iCount + (iCount === 1 ? " code" : " codes");
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