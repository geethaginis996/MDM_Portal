sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/Sorter",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (Controller, JSONModel, Filter, FilterOperator, Sorter, MessageToast, MessageBox) {
    "use strict";

    return Controller.extend("mdm.portal.controller.MyRequests", {

        onInit: function () {
            var oViewModel = new JSONModel({ busy: false });
            this.getView().setModel(oViewModel, "view");

            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("myRequests").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function () {
            // Refresh the table binding each time the route is hit
            var oTable = this.byId("crTable");
            if (oTable) {
                var oBinding = oTable.getBinding("items");
                if (oBinding) { oBinding.refresh(); }
            }
        },

        onFilterChange: function () {
            this._applyFilters();
        },

        onSearch: function () {
            this._applyFilters();
        },

        _applyFilters: function () {
            var sStatus = this.byId("selStatus").getSelectedKey();
            var sType   = this.byId("selType").getSelectedKey();
            var sQuery  = this.byId("sfSearch").getValue().toLowerCase();

            var aFilters = [];
            if (sStatus) { aFilters.push(new Filter("status",       FilterOperator.EQ, sStatus)); }
            if (sType)   { aFilters.push(new Filter("request_type", FilterOperator.EQ, sType)); }
            if (sQuery)  {
                aFilters.push(new Filter({
                    filters: [
                        new Filter({ path: "cr_id",    operator: FilterOperator.Contains, value1: sQuery, caseSensitive: false }),
                        new Filter({ path: "requester",operator: FilterOperator.Contains, value1: sQuery, caseSensitive: false })
                    ],
                    and: false
                }));
            }

            var oTable   = this.byId("crTable");
            var oBinding = oTable.getBinding("items");
            oBinding.filter(aFilters.length
                ? (aFilters.length === 1 ? aFilters : [new Filter({ filters: aFilters, and: true })])
                : []);
        },

        onRefresh: function () {
            var oBinding = this.byId("crTable").getBinding("items");
            if (oBinding) { oBinding.refresh(); }
        },

        onRowPress: function (oEvent) {
            var sCrId = oEvent.getSource().getBindingContext().getProperty("cr_id");
            this.getOwnerComponent().getRouter().navTo("myRequestDetail", {
                crId: encodeURIComponent(sCrId)
            });
        },

        onCrLinkPress: function (oEvent) {
            var sCrId = oEvent.getSource().getBindingContext().getProperty("cr_id");
            this.getOwnerComponent().getRouter().navTo("myRequestDetail", {
                crId: encodeURIComponent(sCrId)
            });
        },

        onCreateBP: function () {
            this.getOwnerComponent().getRouter().navTo("createBP");
        },

        onDeleteRow: function (oEvent) {
            // Stop the row press from firing too
            oEvent.stopPropagation ? oEvent.stopPropagation() : null;

            var oCtx    = oEvent.getSource().getBindingContext();
            var sCrId   = oCtx.getProperty("cr_id");
            var sStatus = oCtx.getProperty("status");

            var sTitle = sStatus === "DRAFT" ? "Delete Draft" : "Cancel Request";
            var sMsg   = sStatus === "DRAFT"
                ? "Permanently delete draft " + sCrId + "? This cannot be undone."
                : "Cancel request " + sCrId + "? It will be marked as Cancelled.";

            MessageBox.confirm(sMsg, {
                title           : sTitle,
                icon            : MessageBox.Icon.WARNING,
                actions         : [MessageBox.Action.YES, MessageBox.Action.NO],
                emphasizedAction: MessageBox.Action.NO,
                onClose         : function (sAction) {
                    if (sAction !== MessageBox.Action.YES) { return; }
                    this._deleteOrCancelCR(sCrId);
                }.bind(this)
            });
        },

        _deleteOrCancelCR: function (sCrId) {
            var oVm    = this.getView().getModel("view");
            var oModel = this.getOwnerComponent().getModel();
            var sUrl   = oModel.getServiceUrl().replace(/\/$/, "") + "/DeleteChangeRequest";

            oVm.setProperty("/busy", true);

            fetch(sUrl, {
                method : "POST",
                headers: { "Content-Type": "application/json", "Accept": "application/json" },
                body   : JSON.stringify({ cr_id: sCrId, reason: "" })
            })
            .then(function (r) {
                if (!r.ok) {
                    return r.json().then(function (e) {
                        throw new Error((e.error && e.error.message) || "HTTP " + r.status);
                    });
                }
                return r.json();
            })
            .then(function (oData) {
                oVm.setProperty("/busy", false);
                MessageToast.show(oData.value && oData.value.message
                    ? oData.value.message : sCrId + " removed.");
                // Refresh the list
                var oBinding = this.byId("crTable").getBinding("items");
                if (oBinding) { oBinding.refresh(); }
            }.bind(this))
            .catch(function (oErr) {
                oVm.setProperty("/busy", false);
                MessageBox.error("Could not remove: " + oErr.message);
            }.bind(this));
        },

        onNavHome: function () {
            this.getOwnerComponent().getRouter().navTo("home", {}, true);
        }
    });
});
