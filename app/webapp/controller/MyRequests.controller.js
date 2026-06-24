sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/Sorter"
], function (Controller, JSONModel, Filter, FilterOperator, Sorter) {
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

        onNavHome: function () {
            this.getOwnerComponent().getRouter().navTo("home");
        }
    });
});
