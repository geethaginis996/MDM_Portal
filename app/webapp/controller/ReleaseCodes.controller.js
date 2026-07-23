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

    return Controller.extend("mdm.portal.controller.ReleaseCodes", {

        // ── Lifecycle ────────────────────────────────────────────────
        onInit: function () {
            this._oUsersCache = {};
            this._oScopeCache = {};

            // "Master Data Type" filter options — a local array with a
            // synthetic "All" entry first, rather than binding the Select
            // directly to the OData /MasterDataTypes collection (mixing a
            // static <core:Item> with a bound aggregation on the same
            // control triggers "list bindings support only a single
            // template object"). Same pattern as ReleaseStrategies.controller.js.
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
            oRouter.getRoute("releaseCodes").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function () {
            var oTable = this.byId("codesTable");
            if (!oTable) { return; }
            var oBinding = oTable.getBinding("items");
            if (oBinding) {
                // Persistent (not "once") — growing/infinite-scroll fires a
                // fresh dataReceived for each additional page, and each one
                // needs its own rows folded into the count caches below.
                oBinding.detachEvent("dataReceived", this._onDataReceived, this);
                oBinding.attachEvent("dataReceived", this._onDataReceived, this);
                oBinding.refresh();
            } else {
                this.getView().attachEventOnce("afterRendering", function () {
                    var oB = this.byId("codesTable").getBinding("items");
                    if (oB) {
                        oB.detachEvent("dataReceived", this._onDataReceived, this);
                        oB.attachEvent("dataReceived", this._onDataReceived, this);
                    }
                }, this);
            }
        },

        _onDataReceived: function () {
            var oTable = this.byId("codesTable");
            if (!oTable) { return; }
            var oBinding = oTable.getBinding("items");
            if (!oBinding) { return; }

            var oHeaderCtx = oBinding.getHeaderContext && oBinding.getHeaderContext();
            if (oHeaderCtx) {
                oHeaderCtx.requestProperty("$count").then(function (iTotal) {
                    var oTitle = this.byId("tableTitle");
                    if (oTitle) { oTitle.setText("Release Codes (" + (iTotal || 0) + ")"); }
                }.bind(this));
            }

            // Binding a formatter directly to an expanded collection path
            // (e.g. text="{path: 'users', formatter: ...}") doesn't reliably
            // work in the OData V4 model — it silently resolves to nothing
            // rather than passing the array through (same issue documented
            // in ReleaseStrategies.controller.js). Instead, read the
            // already-expanded raw data via getObject() (which DOES include
            // $expand'd nested arrays) and cache counts keyed by
            // release_code_id; the cells bind to the plain scalar
            // release_code_id and look themselves up in that cache.
            oBinding.getCurrentContexts().forEach(function (oCtx) {
                if (!oCtx || !oCtx.getObject) { return; }
                var oData = oCtx.getObject();
                if (!oData || !oData.release_code_id) { return; }
                this._oUsersCache[oData.release_code_id] = (oData.users  || []).length;
                this._oScopeCache[oData.release_code_id] = (oData.scopes || []).length;
            }.bind(this));

            // The cells were already rendered with the (empty, at the time)
            // cache — force their formatters to re-run now that the cache
            // holds real data, without triggering a new server request.
            oTable.getItems().forEach(function (oItem) {
                var aCells = oItem.getCells();
                if (aCells[3]) {
                    var oUsersBinding = aCells[3].getBinding("text");
                    if (oUsersBinding) { oUsersBinding.checkUpdate(true); }
                }
                if (aCells[4]) {
                    var oScopeBinding = aCells[4].getBinding("text");
                    if (oScopeBinding) { oScopeBinding.checkUpdate(true); }
                }
            });
        },

        // ── Formatters ───────────────────────────────────────────────
        formatUsersCount: function (sCodeId) {
            var iCount = (this._oUsersCache && this._oUsersCache[sCodeId]) || 0;
            return iCount + (iCount === 1 ? " user" : " users");
        },

        formatScopeCount: function (sCodeId) {
            var iCount = (this._oScopeCache && this._oScopeCache[sCodeId]) || 0;
            return iCount + (iCount === 1 ? " item" : " items");
        },

        // ── Filters ──────────────────────────────────────────────────
        onFilterLiveChange: function () { this._applyFilters(); },
        onFilterChange    : function () { this._applyFilters(); },
        onGo              : function () { this._applyFilters(); },

        _applyFilters: function () {
            var sSearch    = this.byId("filterSearch").getValue();
            var sAppliesTo = this.byId("filterAppliesTo").getSelectedKey();
            var sStatus    = this.byId("filterStatus").getSelectedKey();

            var aFilters = [];
            if (sSearch) {
                aFilters.push(new Filter({
                    filters: [
                        new Filter({ path: "release_code_id", operator: FilterOperator.Contains, value1: sSearch, caseSensitive: false }),
                        new Filter({ path: "description",     operator: FilterOperator.Contains, value1: sSearch, caseSensitive: false })
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

            var oBinding = this.byId("codesTable").getBinding("items");
            if (!oBinding) { return; }
            oBinding.filter(aFilters.length ? [new Filter({ filters: aFilters, and: true })] : []);
            oBinding.attachEventOnce("dataReceived", this._onDataReceived, this);
        },

        onClearFilters: function () {
            this.byId("filterSearch").setValue("");
            this.byId("filterAppliesTo").setSelectedKey("");
            this.byId("filterStatus").setSelectedKey("");
            var oBinding = this.byId("codesTable").getBinding("items");
            if (oBinding) {
                oBinding.filter([]);
                oBinding.attachEventOnce("dataReceived", this._onDataReceived, this);
            }
        },

        // ── Multi-select toolbar ─────────────────────────────────────
        onSelectionChange: function () {
            var bHas = this.byId("codesTable").getSelectedItems().length > 0;
            this.byId("bulkDeleteBtn").setVisible(bHas);
            this.byId("bulkSeparator").setVisible(bHas);
        },

        onBulkDelete: function () {
            var aSelected = this.byId("codesTable").getSelectedItems();
            if (!aSelected.length) { return; }
            MessageBox.confirm("Delete " + aSelected.length + " release code(s)? This cannot be undone.", {
                title  : "Confirm Deletion",
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.OK) {
                        var aPromises = aSelected.map(function (oItem) {
                            return oItem.getBindingContext().delete("$auto");
                        });
                        Promise.all(aPromises)
                            .then(function () { MessageToast.show("Deleted successfully."); })
                            .catch(function (e) { MessageBox.error("Delete failed: " + (e.message || "Unknown error")); });
                    }
                }
            });
        },

        // ── Navigation ───────────────────────────────────────────────
        // IDs are lowercased in the URL and re-uppercased on the detail
        // screen (see ReleaseCodeDetail.controller.js) — same convention
        // used for Release Criteria / Release Strategy routes.
        onLinkPress: function (oEvent) {
            var sId = oEvent.getSource().getBindingContext().getProperty("release_code_id");
            this.getOwnerComponent().getRouter().navTo("releaseCodeDetail", { codeId: encodeURIComponent(sId.toLowerCase()) });
        },

        onRowPress: function (oEvent) {
            var sId = oEvent.getSource().getBindingContext().getProperty("release_code_id");
            this.getOwnerComponent().getRouter().navTo("releaseCodeDetail", { codeId: encodeURIComponent(sId.toLowerCase()) });
        },

        onAdd: function () {
            this.getOwnerComponent().getRouter().navTo("releaseCodeDetail", { codeId: "NEW" });
        },

        // ── Export ───────────────────────────────────────────────────
        onExport: function () {
            var oBinding = this.byId("codesTable").getBinding("items");
            if (!oBinding) { return; }
            oBinding.requestContexts(0, oBinding.getLength()).then(function (aCtx) {
                var aData = aCtx.map(function (oCtx) {
                    var oData = oCtx.getObject();
                    return {
                        "Code"             : oData.release_code_id,
                        "Description"      : oData.description,
                        "Master Data Type" : oData.master_data_type_master_data_type_id || "Any",
                        "SLA (hours)"      : oData.sla_hours,
                        "Users"            : (oData.users  || []).length,
                        "Scope Items"      : (oData.scopes || []).length,
                        "Active"           : oData.active ? "Yes" : "No"
                    };
                });
                this._downloadCSV(aData, "release-codes.csv");
            }.bind(this)).catch(function (e) {
                MessageBox.error("Export failed: " + (e.message || "Unknown error"));
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