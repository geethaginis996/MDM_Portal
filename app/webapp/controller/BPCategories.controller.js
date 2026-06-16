sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (
    Controller, Filter, FilterOperator, JSONModel, MessageToast, MessageBox
) {
    "use strict";

    return Controller.extend("mdm.portal.controller.BPCategories", {

        onInit: function () {
            var oUiModel = new JSONModel({
                totalCount : 0,
                fieldCounts: {}   // { categoryId: fieldCount }
            });
            this.getView().setModel(oUiModel, "ui");
            this._loadFieldCounts();

            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("bpCategories").attachPatternMatched(this._onRouteMatched, this);
        },

        _loadFieldCounts: function () {
            var oModel   = this.getOwnerComponent().getModel();
            var oUiModel = this.getView().getModel("ui");
            oModel.bindList("/BPCategoryFields", null, null, null, {
                $select: "category_category_id,field_field_id"
            }).requestContexts(0, Infinity).then(function (aCtx) {
                var oCounts = {};
                aCtx.forEach(function (c) {
                    var sCat = c.getProperty("category_category_id");
                    if (sCat) { oCounts[sCat] = (oCounts[sCat] || 0) + 1; }
                });
                oUiModel.setProperty("/fieldCounts", oCounts);
            }).catch(function () {});
        },

        _onRouteMatched: function () {
            var oTable = this.byId("catTable");
            if (!oTable) { return; }
            var oBinding = oTable.getBinding("items");
            if (oBinding) {
                oBinding.attachEventOnce("dataReceived", this._onDataReceived, this);
                oBinding.refresh();
            } else {
                this.getView().attachEventOnce("afterRendering", function () {
                    var oB = this.byId("catTable").getBinding("items");
                    if (oB) { oB.attachEventOnce("dataReceived", this._onDataReceived, this); }
                }, this);
            }
        },

        _onDataReceived: function () {
            var oBinding = this.byId("catTable").getBinding("items");
            if (!oBinding) { return; }
            var oHeaderCtx = oBinding.getHeaderContext && oBinding.getHeaderContext();
            if (oHeaderCtx) {
                oHeaderCtx.requestProperty("$count").then(function (iTotal) {
                    this.byId("tableTitle").setText("BP Categories (" + (iTotal || 0) + ")");
                    this.getView().getModel("ui").setProperty("/totalCount", iTotal || 0);
                }.bind(this));
            }
            this._loadFieldCounts();
        },

        // ── Formatters ───────────────────────────────────────────────
        formatIcon: function (sIcon) {
            if (sIcon && typeof sIcon === "string" && sIcon.indexOf("sap-icon://") === 0) {
                return sIcon;
            }
            return "sap-icon://product";
        },
        formatActiveText: function (vActive) {
            return this._isActive(vActive) ? "Active" : "Inactive";
        },
        formatActiveState: function (vActive) {
            return this._isActive(vActive) ? "Success" : "Error";
        },
        _isActive: function (v) {
            if (typeof v === "string") {
                var s = v.trim().toLowerCase();
                return (s === "yes" || s === "true" || s === "1" || s === "active" || s === "x");
            }
            return v === true || v === 1;
        },
        formatCount: function (sCatId, oCounts) {
            if (!sCatId || !oCounts) { return "0"; }
            var iCount = oCounts[sCatId];
            return (iCount === undefined || iCount === null) ? "0" : String(iCount);
        },

        // ── Filters ──────────────────────────────────────────────────
        onFilterChange: function () { this._applyFilters(); },
        onGo          : function () { this._applyFilters(); },

        _applyFilters: function () {
            var sCat    = this.byId("filterCategory").getSelectedKey();
            var sStatus = this.byId("filterStatus").getSelectedKey();
            var aFilters = [];
            if (sCat) {
                aFilters.push(new Filter("category_id", FilterOperator.EQ, sCat));
            }
            if (sStatus !== "") {
                aFilters.push(new Filter("active", FilterOperator.EQ, sStatus === "true"));
            }
            var oBinding = this.byId("catTable").getBinding("items");
            if (!oBinding) { return; }
            oBinding.filter(aFilters.length ? [new Filter({ filters: aFilters, and: true })] : []);
            oBinding.attachEventOnce("dataReceived", this._onDataReceived, this);
        },

        onClearFilters: function () {
            this.byId("filterCategory").setSelectedKey("");
            this.byId("filterStatus").setSelectedKey("");
            var oBinding = this.byId("catTable").getBinding("items");
            if (oBinding) {
                oBinding.filter([]);
                oBinding.attachEventOnce("dataReceived", this._onDataReceived, this);
            }
        },

        // ── Navigation ───────────────────────────────────────────────
        onLinkPress: function (oEvent) {
            var sId = oEvent.getSource().getBindingContext().getProperty("category_id");
            this.getOwnerComponent().getRouter().navTo("bpCategoryDetail", { categoryId: encodeURIComponent(sId) });
        },

        onRowPress: function (oEvent) {
            var sId = oEvent.getSource().getBindingContext().getProperty("category_id");
            this.getOwnerComponent().getRouter().navTo("bpCategoryDetail", { categoryId: encodeURIComponent(sId) });
        },

        // ── Export ───────────────────────────────────────────────────
        onExport: function () {
            var oBinding = this.byId("catTable").getBinding("items");
            if (!oBinding) { return; }
            oBinding.requestContexts(0, oBinding.getLength()).then(function (aCtx) {
                var aData = aCtx.map(function (oCtx) {
                    return {
                        "Category ID": oCtx.getProperty("category_id"),
                        "Description": oCtx.getProperty("description"),
                        "Sequence"   : oCtx.getProperty("sequence"),
                        "Active"     : oCtx.getProperty("active") ? "Yes" : "No"
                    };
                });
                this._downloadCSV(aData, "bp-categories.csv");
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